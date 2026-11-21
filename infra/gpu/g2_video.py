"""
CB Studio — GPU própria (Modal, serverless).

Roda o Wan 2.2 (imagem → vídeo, 14B, licença Apache-2.0) com a versão "Lightning" de 4 passos
numa GPU alugada por segundo. A máquina liga quando o app pede um vídeo e desliga sozinha
depois de 2 min parada — não é uma VPS: não tem servidor ligado nem nada pra manter.

Deploy (uma vez, no Mac):
    pip install modal && modal setup                 # login no navegador
    modal secret create g2-gpu G2_GPU_TOKEN=<token>  # o mesmo valor vai no .env do app
    modal deploy infra/gpu/g2_video.py

Teste rápido sem o app:
    modal run infra/gpu/g2_video.py --image caminho/da/imagem.png --prompt "he walks fast"

Contrato HTTP (o CB Studio fala com isto):
    POST {url}/jobs           {image, prompt, negative?, width?, height?, frames?, steps?, seed?} → {id}
    GET  {url}/jobs/{id}      → {status: queued|running}  ou  {status: succeeded, video_b64, gpu, gpu_seconds}
    Authorization: Bearer <G2_GPU_TOKEN>
"""

from __future__ import annotations

import base64
import io
import os
import time

import modal

APP_NAME = "g2-video"
GPU = os.environ.get("G2_GPU", "H100")  # H100 = mais rápido por vídeo; "L40S" = mais barato por hora (usa offload)
MODEL_ID = "Wan-AI/Wan2.2-I2V-A14B-Diffusers"
LORA_REPO = "lightx2v/Wan2.2-Lightning"
LORA_DIR = "Wan2.2-I2V-A14B-4steps-lora-rank64-Seko-V1"
CACHE = "/cache"

app = modal.App(APP_NAME)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git")
    .pip_install("torch==2.6.0", "torchvision==0.21.0", extra_index_url="https://download.pytorch.org/whl/cu124")
    .pip_install(
        "diffusers==0.36.0",
        "transformers==4.51.3",
        "accelerate==1.6.0",
        "peft==0.15.2",
        "sentencepiece==0.2.0",
        "ftfy==6.3.1",
        "imageio==2.37.0",
        "imageio-ffmpeg==0.6.0",
        "pillow==11.2.1",
        "requests==2.32.3",
        "huggingface_hub[hf_transfer]==0.30.2",
        "fastapi[standard]==0.115.12",
    )
    .env({"HF_HOME": CACHE, "HF_HUB_ENABLE_HF_TRANSFER": "1", "TOKENIZERS_PARALLELISM": "false"})
)

# os pesos (~60 GB) ficam num volume: baixam uma vez só, não a cada vez que a máquina liga
weights = modal.Volume.from_name("g2-hf-cache", create_if_missing=True)
secret = modal.Secret.from_name("g2-gpu", required_keys=["G2_GPU_TOKEN"])

NEGATIVE = (
    "static, frozen frame, slow motion, blurry, low quality, jpeg artifacts, distorted face, deformed hands, extra fingers, "
    "text, watermark, logo, subtitles, morphing objects, flicker"
)


def _load_image(src: str):
    from PIL import Image

    if src.startswith("data:"):
        raw = base64.b64decode(src.split(",", 1)[1])
    elif src.startswith("http"):
        import requests

        r = requests.get(src, timeout=60)
        r.raise_for_status()
        raw = r.content
    else:
        raw = base64.b64decode(src)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def _fit(img, width: int, height: int):
    """corta no centro e redimensiona pro tamanho de saída (sem esticar)"""
    from PIL import Image

    src_r, dst_r = img.width / img.height, width / height
    if src_r > dst_r:
        w = int(img.height * dst_r)
        img = img.crop(((img.width - w) // 2, 0, (img.width - w) // 2 + w, img.height))
    else:
        h = int(img.width / dst_r)
        img = img.crop((0, (img.height - h) // 2, img.width, (img.height - h) // 2 + h))
    return img.resize((width, height), Image.LANCZOS)


@app.cls(
    image=image,
    gpu=GPU,
    volumes={CACHE: weights},
    secrets=[secret],
    timeout=20 * 60,
    startup_timeout=30 * 60,  # primeira vez: carrega ~60 GB do volume
    scaledown_window=120,  # 2 min parada → desliga (para de cobrar)
    max_containers=4,
    memory=32768 if GPU.upper().startswith(("H100", "H200", "A100-80", "B200")) else 98304,
)
class Wan22:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import WanImageToVideoPipeline

        t0 = time.time()
        big = GPU.upper().startswith(("H100", "H200", "A100-80", "B200"))
        # GPU de 80 GB: carrega direto nela (pouca RAM na máquina = mais barato); 48 GB: carrega na RAM e alterna
        self.pipe = WanImageToVideoPipeline.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16, **({"device_map": "cuda"} if big else {}))
        lora_ok = True
        try:
            self.pipe.load_lora_weights(LORA_REPO, weight_name=f"{LORA_DIR}/high_noise_model.safetensors", adapter_name="light")
            self.pipe.load_lora_weights(
                LORA_REPO, weight_name=f"{LORA_DIR}/low_noise_model.safetensors", adapter_name="light_2", load_into_transformer_2=True
            )
            self.pipe.set_adapters(["light", "light_2"], adapter_weights=[1.0, 1.0])
        except Exception as e:  # sem o Lightning ainda funciona, só que com 40 passos (bem mais lento)
            print("Lightning LoRA não carregou:", repr(e))
            lora_ok = False
        self.fast = lora_ok
        if not big:
            # 48 GB (L40S): os dois especialistas de 14B não cabem juntos — alterna entre CPU e GPU
            self.pipe.enable_model_cpu_offload()
        print(f"modelo pronto em {time.time() - t0:.0f}s (lightning={lora_ok})")

    @modal.method()
    def generate(self, image: str, prompt: str, negative: str = "", width: int = 720, height: int = 1280,
                 frames: int = 81, steps: int = 0, seed: int = -1) -> dict:
        import tempfile

        import torch
        from diffusers.utils import export_to_video

        t0 = time.time()
        img = _fit(_load_image(image), width, height)
        steps = steps or (4 if self.fast else 40)
        cfg = 1.0 if self.fast else 3.5
        gen = torch.Generator("cuda").manual_seed(seed if seed >= 0 else int(time.time()) % 2_000_000_000)
        out = self.pipe(
            image=img,
            prompt=prompt,
            negative_prompt=negative or NEGATIVE,
            width=width,
            height=height,
            num_frames=frames,
            num_inference_steps=steps,
            guidance_scale=cfg,
            guidance_scale_2=cfg,
            generator=gen,
        ).frames[0]
        with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
            export_to_video(out, f.name, fps=16)
            data = open(f.name, "rb").read()
        secs = time.time() - t0
        return {"video_b64": base64.b64encode(data).decode(), "gpu": GPU, "gpu_seconds": round(secs, 1), "steps": steps, "fps": 16, "frames": frames}


@app.function(image=image, volumes={CACHE: weights}, timeout=60 * 60)
def download():
    """baixa os pesos pro volume uma vez (modal run infra/gpu/g2_video.py::download) — sem GPU, custa centavos"""
    from huggingface_hub import hf_hub_download, snapshot_download

    snapshot_download(MODEL_ID)
    for f in ("high_noise_model.safetensors", "low_noise_model.safetensors"):
        hf_hub_download(LORA_REPO, f"{LORA_DIR}/{f}")
    weights.commit()
    print("pesos no volume g2-hf-cache")


# ───────────────────────────── API HTTP ─────────────────────────────

web_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]==0.115.12")


@app.function(image=web_image, secrets=[secret], scaledown_window=300)
@modal.asgi_app(label="g2-video-api")
def api():
    from fastapi import FastAPI, Header, HTTPException
    from pydantic import BaseModel

    web = FastAPI(title="CB Studio GPU")
    token = os.environ["G2_GPU_TOKEN"]

    def check(auth: str | None):
        if auth != f"Bearer {token}":
            raise HTTPException(401, "token inválido")

    class Job(BaseModel):
        image: str
        prompt: str
        negative: str = ""
        width: int = 720
        height: int = 1280
        frames: int = 81
        steps: int = 0
        seed: int = -1

    @web.get("/health")
    def health():
        return {"ok": True, "gpu": GPU, "model": MODEL_ID}

    @web.post("/jobs")
    def create(job: Job, authorization: str | None = Header(default=None)):
        check(authorization)
        if job.width % 16 or job.height % 16:
            raise HTTPException(400, "largura e altura precisam ser múltiplos de 16")
        if not 17 <= job.frames <= 121:
            raise HTTPException(400, "frames entre 17 e 121")
        call = Wan22().generate.spawn(**job.model_dump())
        return {"id": call.object_id}

    @web.get("/jobs/{call_id}")
    def status(call_id: str, authorization: str | None = Header(default=None)):
        check(authorization)
        call = modal.FunctionCall.from_id(call_id)
        try:
            result = call.get(timeout=0)
        except TimeoutError:
            return {"status": "running"}
        except Exception as e:  # erro dentro da GPU
            return {"status": "failed", "error": str(e)[:500]}
        return {"status": "succeeded", **result}

    return web


@app.local_entrypoint()
def main(image: str, prompt: str = "the camera slowly pushes in, natural motion", out: str = "teste-wan22.mp4", width: int = 720, height: int = 1280):
    """teste: modal run infra/gpu/g2_video.py --image foto.png --prompt "..." """
    b64 = base64.b64encode(open(image, "rb").read()).decode()
    t0 = time.time()
    r = Wan22().generate.remote(image=b64, prompt=prompt, width=width, height=height)
    open(out, "wb").write(base64.b64decode(r["video_b64"]))
    print(f"ok: {out} — {r['gpu_seconds']}s de GPU ({r['gpu']}), {time.time() - t0:.0f}s no total, {r['steps']} passos")
