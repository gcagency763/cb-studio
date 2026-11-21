import { type GenerationRequest, type MediaKind, type PollResult, type Provider, type SubmitResult, type VideoRequest, ProviderError } from "../types.js";

/**
 * GPU própria (serverless no Modal) — Wan 2.2 imagem→vídeo com Lightning (4 passos).
 * O código do servidor fica em infra/gpu/g2_video.py. A máquina liga quando chega um pedido e
 * desliga sozinha; paga só os segundos de GPU (o Modal dá US$ 30/mês de crédito grátis).
 */
export interface GpuConfig {
  /** URL do app do Wan 2.2 no Modal (ex.: https://<workspace>--g2-video-api.modal.run) */
  url?: string;
  /** URL do app do MiniMax H3 no Modal (infra/gpu/g2_h3.py) */
  h3Url?: string;
  token: string;
  /** custo da hora das 4 H100 do H3 (+ CPU/RAM) */
  h3UsdPerHour?: number;
  /** segundos estimados por clipe de 5 s no H3 Turbo (ajuste com o tempo medido) */
  h3SecPerClip?: number;
  /** custo da hora de GPU + CPU/RAM (H100 no Modal ≈ US$ 3,95 + ~0,15) */
  usdPerHour?: number;
  /** segundos de GPU estimados por clipe de 5 s (ajuste com o tempo real medido) */
  secPerClip720?: number;
  secPerClip480?: number;
}

// H3: múltiplos de 32, lado curto 768 (720p no app) ou 480
const SIZE_H3: Record<string, Record<"480p" | "720p", [number, number]>> = {
  "9:16": { "480p": [480, 832], "720p": [768, 1344] },
  "16:9": { "480p": [832, 480], "720p": [1344, 768] },
  "1:1": { "480p": [480, 480], "720p": [768, 768] },
  "3:4": { "480p": [480, 640], "720p": [768, 1024] },
  "4:3": { "480p": [640, 480], "720p": [1024, 768] },
};

const SIZE: Record<string, Record<"480p" | "720p", [number, number]>> = {
  "9:16": { "480p": [480, 832], "720p": [720, 1280] },
  "16:9": { "480p": [832, 480], "720p": [1280, 720] },
  "1:1": { "480p": [640, 640], "720p": [960, 960] },
  "3:4": { "480p": [480, 640], "720p": [720, 960] },
  "4:3": { "480p": [640, 480], "720p": [960, 720] },
};

export class GpuProvider implements Provider {
  readonly name = "gpu";
  private rate: number;

  constructor(private cfg: GpuConfig) {
    if (!(cfg.url || cfg.h3Url) || !cfg.token) throw new ProviderError(this.name, "G2_GPU_URL (ou G2_GPU_H3_URL) e G2_GPU_TOKEN ausentes");
    this.rate = cfg.usdPerHour ?? 4.1;
  }

  private isH3(req: { model?: string }) {
    return req.model === "minimax-h3-gpu";
  }

  private baseFor(h3: boolean) {
    const url = h3 ? this.cfg.h3Url : this.cfg.url;
    if (!url) throw new ProviderError(this.name, h3 ? "H3 na GPU própria não ligado (G2_GPU_H3_URL)" : "Wan 2.2 na GPU própria não ligado (G2_GPU_URL)");
    return url.replace(/\/$/, "");
  }

  supports(kind: MediaKind) {
    return kind === "video";
  }

  private res(req: VideoRequest): "480p" | "720p" {
    return req.resolution === "480p" ? "480p" : "720p";
  }

  estimateCost(req: GenerationRequest): number {
    if (req.kind !== "video") return 0;
    if (this.isH3(req)) {
      // 4× H100 por segundo; o tempo cresce com a duração (estimativa até medir de verdade)
      const sec = (this.cfg.h3SecPerClip ?? 30) * ((req.durationSec ?? 5) / 5) * (this.res(req) === "480p" ? 0.5 : 1);
      return +((sec / 3600) * (this.cfg.h3UsdPerHour ?? 17.8)).toFixed(4);
    }
    const sec = this.res(req) === "480p" ? this.cfg.secPerClip480 ?? 45 : this.cfg.secPerClip720 ?? 120;
    return +((sec / 3600) * this.rate).toFixed(4);
  }

  private async http<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(path.startsWith("/jobs/") ? 120_000 : 60_000),
      headers: { Authorization: `Bearer ${this.cfg.token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    const text = await res.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* texto */
    }
    if (!res.ok) throw new ProviderError(this.name, `${res.status} ${body?.detail ?? String(text).slice(0, 200)}`, res.status, body);
    return body as T;
  }

  async submit(req: GenerationRequest): Promise<SubmitResult> {
    if (req.kind !== "video") throw new ProviderError(this.name, "só gera vídeo");
    if (!req.firstFrame) throw new ProviderError(this.name, "o Wan 2.2 daqui anima uma imagem — gere a imagem da cena antes");
    const h3 = this.isH3(req);
    const base = this.baseFor(h3);
    if (h3) {
      const [width, height] = (SIZE_H3[req.ratio ?? "9:16"] ?? SIZE_H3["9:16"])[this.res(req)];
      const duration = Math.min(15, Math.max(4, req.durationSec ?? 5));
      const out = await this.http<{ id: string }>(base, "/jobs", {
        method: "POST",
        body: JSON.stringify({ image: req.firstFrame, prompt: req.prompt, width, height, duration, seed: req.seed ?? -1 }),
      });
      return { providerJobId: `gpu:h3:${out.id}`, estimatedCostUsd: this.estimateCost(req) };
    }
    const [width, height] = (SIZE[req.ratio ?? "9:16"] ?? SIZE["9:16"])[this.res(req)];
    // 16 quadros por segundo; o modelo foi treinado com até 81 (≈ 5 s)
    const frames = Math.min(81, Math.max(17, Math.round((req.durationSec ?? 5) * 16) + 1));
    const out = await this.http<{ id: string }>(base, "/jobs", {
      method: "POST",
      body: JSON.stringify({ image: req.firstFrame, prompt: req.prompt, width, height, frames: frames - ((frames - 1) % 4), seed: req.seed ?? -1 }),
    });
    return { providerJobId: `gpu:${out.id}`, estimatedCostUsd: this.estimateCost(req) };
  }

  async poll(providerJobId: string): Promise<PollResult> {
    const h3 = providerJobId.startsWith("gpu:h3:");
    const id = providerJobId.replace(/^gpu:(h3:)?/, "");
    const r = await this.http<{ status: string; video_b64?: string; gpu?: string; gpu_seconds?: number; wall_seconds?: number; error?: string; steps?: number; fps?: number }>(
      this.baseFor(h3),
      `/jobs/${id}`,
    );
    if (r.status === "succeeded" && r.video_b64) {
      const sec = r.gpu_seconds ?? 0;
      // H3: gpu_seconds já soma as 4 GPUs; o custo usa o tempo de parede × preço das 4
      const cost = h3 ? ((r.wall_seconds ?? sec / 4) / 3600) * (this.cfg.h3UsdPerHour ?? 17.8) : (sec / 3600) * this.rate;
      return {
        status: "succeeded",
        outputBytes: new Uint8Array(Buffer.from(r.video_b64, "base64")),
        contentType: "video/mp4",
        usage: { gpu_seconds: sec, cost_usd: +cost.toFixed(4), steps: r.steps ?? 0 },
        meta: { gpu: r.gpu, fps: r.fps ?? 16, model: h3 ? "MiniMax H3" : "Wan 2.2" },
      };
    }
    if (r.status === "failed") return { status: "failed", error: r.error ?? "falhou na GPU" };
    return { status: "running" };
  }

  async download(url: string): Promise<Uint8Array> {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new ProviderError(this.name, `download ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
