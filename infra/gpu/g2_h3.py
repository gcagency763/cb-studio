"""
CB Studio — MiniMax H3 na GPU própria (Modal, serverless) · EXPERIMENTAL

O H3 é o modelo aberto mais perto do Seedance 2.5 (4º em imagem→vídeo na Artificial Analysis).
Roda com o vLLM-Omni em 4× H100, com o LoRA "Turbo" de 4 passos. Liga quando o app pede um vídeo
e desliga sozinha depois de 5 min parada. Vale a pena em lote (um episódio inteiro de uma vez):
ligar a máquina leva alguns minutos e esses minutos também são cobrados.

Licença (MiniMax H3 Community License, 02/08/2026): pesos usáveis no Brasil; empresa com mais de
US$ 20 mi/ano de faturamento precisa de autorização; telas que usam o H3 mostram "MiniMax H3".

Pré-requisitos (uma vez):
  1. huggingface.co → aceitar a licença em MiniMaxAI/MiniMax-H3 → Settings → Access Tokens (read)
  2. modal secret create g2-hf HF_TOKEN=<token do Hugging Face>
  3. modal secret create g2-gpu G2_GPU_TOKEN=<o mesmo do .env>   (já existe se o Wan foi ligado)
  4. modal run infra/gpu/g2_h3.py::download     (baixa ~120 GB pro volume, sem GPU)
  5. modal deploy infra/gpu/g2_h3.py            → G2_GPU_H3_URL no .env

Mesmo contrato HTTP do g2_video.py: POST /jobs → {id} · GET /jobs/{id} → status / video_b64.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import time

import modal

APP_NAME = "g2-h3"
GPU = os.environ.get("G2_H3_GPU", "H100:4")
N_GPUS = int(GPU.split(":")[1]) if ":" in GPU else 1
MODEL_REPO = "MiniMaxAI/MiniMax-H3"
TURBO_REPO = "lightx2v/Minimax-h3-Turbo"
TURBO_FILE = os.environ.get("G2_H3_TURBO_FILE", "v1.0_768p.safetensors")  # 4 passos, flow_shift 6
WEIGHTS = "/weights"
PORT = 8000

app = modal.App(APP_NAME)

image = (
    modal.Image.from_registry("nvidia/cuda:12.8.1-devel-ubuntu22.04", add_python="3.12")
    .apt_install("git", "ffmpeg", "curl")
    .pip_install("uv")
    .run_commands(
        "git clone --depth 1 https://github.com/vllm-project/vllm-omni.git /opt/vllm-omni",
        "cd /opt/vllm-omni && uv pip install --system -e .",
    )
    .pip_install("huggingface_hub[hf_transfer]", "requests", "fastapi[standard]")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1", "VLLM_WORKER_MULTIPROC_METHOD": "spawn", "VLLM_OMNI_VIDEO_SYNC_TIMEOUT": "1800"})
)

weights = modal.Volume.from_name("g2-h3-weights", create_if_missing=True)
gpu_secret = modal.Secret.from_name("g2-gpu", required_keys=["G2_GPU_TOKEN"])
hf_secret = modal.Secret.from_name("g2-hf", required_keys=["HF_TOKEN"])


@app.function(image=image, volumes={WEIGHTS: weights}, secrets=[hf_secret], timeout=3 * 60 * 60)
def download():
    """baixa o H3 (pedido de acesso aprovado no Hugging Face) e o LoRA Turbo pro volume — sem GPU"""
    from huggingface_hub import hf_hub_download, snapshot_download

    snapshot_download(MODEL_REPO, local_dir=f"{WEIGHTS}/MiniMax-H3", token=os.environ["HF_TOKEN"])
    hf_hub_download(TURBO_REPO, TURBO_FILE, local_dir=f"{WEIGHTS}/turbo", token=os.environ["HF_TOKEN"])
    weights.commit()
    print("ok: H3 + Turbo no volume g2-h3-weights")


@app.cls(
    image=image,
    gpu=GPU,
    volumes={WEIGHTS: weights},
    secrets=[gpu_secret],
    timeout=30 * 60,
    startup_timeout=40 * 60,
    scaledown_window=300,
    max_containers=1,
    memory=131072,
)
class H3:
    @modal.enter()
    def start(self):
        import requests

        t0 = time.time()
        cmd = [
            "vllm", "serve", f"{WEIGHTS}/MiniMax-H3", "--omni", "--trust-remote-code",
            "--host", "127.0.0.1", "--port", str(PORT),
            "--num-gpus", str(N_GPUS), "--usp", str(N_GPUS), "--ring", "1",
            "--task-type", "fl2va",
            "--vae-patch-parallel-size", str(N_GPUS), "--vae-parallel-mode", "tile", "--vae-use-tiling",
            "--max-num-seqs", "1",
            "--lora-backend", "peft", "--lora-path", f"{WEIGHTS}/turbo/{TURBO_FILE}",
        ]
        print("subindo:", " ".join(cmd))
        self.proc = subprocess.Popen(cmd)
        while True:
            if self.proc.poll() is not None:
                raise RuntimeError(f"vllm saiu com código {self.proc.returncode}")
            try:
                if requests.get(f"http://127.0.0.1:{PORT}/health", timeout=5).ok:
                    break
            except Exception:
                pass
            time.sleep(5)
        print(f"H3 pronto em {time.time() - t0:.0f}s")

    @modal.exit()
    def stop(self):
        self.proc.terminate()

    @modal.method()
    def generate(self, image: str, prompt: str, negative: str = "", width: int = 768, height: int = 1344,
                 frames: int = 0, steps: int = 0, seed: int = -1, duration: float = 5.0) -> dict:
        import requests

        t0 = time.time()
        raw = base64.b64decode(image.split(",", 1)[1] if image.startswith("data:") else image)
        extra = {"task": "fl2va", "duration": float(duration), "audio_flow_shift": 3.0,
                 "lora": {"path": f"{WEIGHTS}/turbo/{TURBO_FILE}", "scale": 1.0}}
        form = {
            "prompt": prompt,
            "width": str(width), "height": str(height), "fps": "24",
            "num_inference_steps": str(steps or 4), "flow_shift": "6",
            "seed": str(seed if seed >= 0 else int(time.time()) % 2_000_000_000),
            "extra_params": json.dumps(extra),
        }
        if negative:
            form["negative_prompt"] = negative
        r = requests.post(f"http://127.0.0.1:{PORT}/v1/videos/sync", data=form,
                          files={"input_reference": ("frame.png", raw, "image/png")}, timeout=1800)
        if not r.ok:
            raise RuntimeError(f"H3 {r.status_code}: {r.text[:400]}")
        secs = time.time() - t0
        return {"video_b64": base64.b64encode(r.content).decode(), "gpu": GPU, "gpu_seconds": round(secs * N_GPUS, 1),
                "wall_seconds": round(secs, 1), "steps": steps or 4, "fps": 24}


web_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]==0.115.12")


@app.function(image=web_image, secrets=[gpu_secret], scaledown_window=300)
@modal.asgi_app(label="g2-h3-api")
def api():
    from fastapi import FastAPI, Header, HTTPException
    from pydantic import BaseModel

    web = FastAPI(title="CB Studio · MiniMax H3")
    token = os.environ["G2_GPU_TOKEN"]

    def check(auth: str | None):
        if auth != f"Bearer {token}":
            raise HTTPException(401, "token inválido")

    class Job(BaseModel):
        image: str
        prompt: str
        negative: str = ""
        width: int = 768
        height: int = 1344
        frames: int = 0
        steps: int = 0
        seed: int = -1
        duration: float = 5.0

    @web.get("/health")
    def health():
        return {"ok": True, "gpu": GPU, "model": MODEL_REPO, "turbo": TURBO_FILE}

    @web.post("/jobs")
    def create(job: Job, authorization: str | None = Header(default=None)):
        check(authorization)
        if job.width % 32 or job.height % 32:
            raise HTTPException(400, "largura e altura precisam ser múltiplos de 32")
        if not 4 <= job.duration <= 15:
            raise HTTPException(400, "duração entre 4 e 15 s")
        call = H3().generate.spawn(**job.model_dump())
        return {"id": call.object_id}

    @web.get("/jobs/{call_id}")
    def status(call_id: str, authorization: str | None = Header(default=None)):
        check(authorization)
        call = modal.FunctionCall.from_id(call_id)
        try:
            result = call.get(timeout=0)
        except TimeoutError:
            return {"status": "running"}
        except Exception as e:
            return {"status": "failed", "error": str(e)[:500]}
        return {"status": "succeeded", **result}

    return web
