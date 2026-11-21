import { CATALOG, findModel, type CatalogModel } from "../catalog.js";
import { type GenerationRequest, type PollResult, type Provider, type SubmitResult, ProviderError } from "../types.js";

/**
 * fal.ai — um provedor pra vários modelos: Kling (2.5 turbo / 2.6 / 3.0 / 3.0 turbo / 4.0),
 * Nano Banana Pro, GPT Image 1.5, upscale (Clarity, estilo Magnific), avatar (OmniHuman 1.5, Kling Avatar).
 * Fila REST: POST https://queue.fal.run/{endpoint} → { request_id, status_url, response_url }
 * Conta pré-paga (mínimo US$ 10); paga por uso. Precisa de FAL_KEY.
 */

export interface FalConfig {
  apiKey: string;
}

type FalStatus = { status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED"; response_url?: string; queue_position?: number };

const DEFAULTS: Record<string, string> = {
  video: "kling-2.5-turbo",
  image: "nano-banana-2.1",
  upscale: "clarity-upscaler",
  avatar: "omnihuman-1.5",
  lipsync: "sync-lipsync-2",
};

export class FalProvider implements Provider {
  readonly name = "fal";
  /** providerJobId → { statusUrl, responseUrl, kind } */
  private jobs = new Map<string, { statusUrl: string; responseUrl: string; kind: string }>();

  constructor(private cfg: FalConfig) {
    if (!cfg.apiKey) throw new ProviderError(this.name, "FAL_KEY ausente");
  }

  supports(kind: GenerationRequest["kind"]) {
    return kind !== "audio" && kind !== "sfx";
  }

  private modelFor(req: GenerationRequest): CatalogModel {
    const id = (req as { model?: string }).model;
    const m = findModel(id) ?? CATALOG.find((c) => c.id === DEFAULTS[req.kind]);
    if (!m || m.provider !== "fal" || !m.fal) throw new ProviderError(this.name, `modelo ${id ?? req.kind} não é da fal`);
    return m;
  }

  estimateCost(req: GenerationRequest): number {
    const m = this.modelFor(req);
    switch (req.kind) {
      case "video": {
        const res = m.fal?.family === "h3" ? (req.resolution === "480p" ? "480p" : "720p") : req.resolution === "480p" ? "720p" : (req.resolution ?? "1080p");
        let perSec = m.price.perSec?.[res] ?? m.price.perSec?.["1080p"] ?? 0.1;
        if (m.nativeAudio && req.audio && m.id !== "kling-4.0") perSec *= m.id === "kling-3.0" ? 1.5 : 2; // áudio nativo custa mais no 2.6/3.0
        return +((req.durationSec ?? 5) * perSec).toFixed(4);
      }
      case "image":
        return m.price.perImage ?? 0.15;
      case "upscale": {
        const f = req.factor ?? 2;
        const outMp = (req.inputMp ?? 3.7) * f * f;
        return +(outMp * (m.price.perMp ?? 0.03)).toFixed(4);
      }
      case "avatar":
        return +((req.audioSec ?? 15) * (m.price.perSec?.["1080p"] ?? 0.16)).toFixed(4);
      case "lipsync":
        return +(((req.videoSec ?? 10) / 60) * (m.price.perMin ?? 3) * (req.pro ? 1.67 : 1)).toFixed(4);
      default:
        return 0;
    }
  }

  private async http<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Key ${this.cfg.apiKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    const text = await res.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* texto */
    }
    if (!res.ok) {
      const msg = body?.detail?.[0]?.msg ?? body?.detail ?? body?.error ?? res.statusText;
      throw new ProviderError(this.name, `${res.status} ${typeof msg === "string" ? msg : JSON.stringify(msg)}`, res.status, body);
    }
    return body as T;
  }

  /** monta endpoint + input por família de modelo */
  private build(req: GenerationRequest, m: CatalogModel): { endpoint: string; input: Record<string, unknown> } {
    const f = m.fal!;
    switch (req.kind) {
      case "video": {
        const duration = Math.min(Math.max(...(m.durations ?? [10])), Math.max(Math.min(...(m.durations ?? [3])), req.durationSec ?? 5));
        if (f.family === "kling4") {
          const resolution = req.resolution === "480p" ? "720p" : (req.resolution ?? "1080p");
          const endpoint = req.firstFrame ? f.i2v! : f.t2v!;
          const input: Record<string, unknown> = { prompt: req.prompt, duration, resolution };
          if (req.firstFrame) input.start_image_url = req.firstFrame;
          if (req.lastFrame) input.end_image_url = req.lastFrame;
          if (!req.firstFrame && req.ratio) input.aspect_ratio = req.ratio;
          return { endpoint, input };
        }
        if (f.family === "h3") {
          // MiniMax H3: 480P e 768P são nativos (2K/4K seriam upscale); o formato segue a imagem; sem imagem → texto→vídeo 16:9
          if (!req.firstFrame && !req.lastFrame) throw new ProviderError(this.name, `${m.name} anima a imagem da cena — gere a imagem antes`);
          const endpoint = f.i2v!;
          const input: Record<string, unknown> = { prompt: req.prompt, duration, resolution: req.resolution === "480p" ? "480P" : "768P", prompt_expansion_mode: "disabled" };
          if (req.firstFrame) input.image_url = req.firstFrame;
          if (req.lastFrame) input.end_image_url = req.lastFrame;
          if (req.seed != null) input.seed = req.seed;
          return { endpoint, input };
        }
        if (f.family === "grok") {
          if (!req.firstFrame) throw new ProviderError(this.name, `${m.name} só gera a partir de uma imagem`);
          return { endpoint: f.i2v!, input: { image_url: req.firstFrame, prompt: req.prompt, duration, resolution: req.resolution ?? "720p" } };
        }
        // Kling 2.5 / 2.6 / 3.0 / 3.0 turbo
        if (!req.firstFrame && !f.t2v) throw new ProviderError(this.name, `${m.name} só gera a partir de uma imagem (primeiro frame)`);
        const endpoint = req.firstFrame ? f.i2v! : f.t2v!;
        const input: Record<string, unknown> = { prompt: req.prompt, duration: String(duration) };
        if (req.firstFrame) {
          // v3 pro usa start_image_url; v2.5/v2.6/v3 turbo usam image_url
          if (endpoint.includes("/v3/pro/")) input.start_image_url = req.firstFrame;
          else input.image_url = req.firstFrame;
          if (req.lastFrame && endpoint.includes("/v3/pro/")) input.end_image_url = req.lastFrame;
          else if (req.lastFrame) input.tail_image_url = req.lastFrame;
        } else if (req.ratio) input.aspect_ratio = req.ratio;
        if (m.nativeAudio) input.generate_audio = !!req.audio;
        input.negative_prompt = "blur, distort, low quality, text, watermark";
        return { endpoint, input };
      }
      case "image": {
        const ref = req.referenceImages?.[0];
        const [w, h] = (req.size ?? "1440x2560").split("x").map(Number);
        const endpoint = ref ? f.i2v! : f.endpoint!;
        if (f.family === "nano") {
          const ar = w > h ? "16:9" : w < h ? "9:16" : "1:1";
          const input: Record<string, unknown> = { prompt: req.prompt, aspect_ratio: ar, resolution: "2K", num_images: 1, output_format: "png" };
          if (ref) input.image_urls = req.referenceImages;
          return { endpoint, input };
        }
        if (m.id === "gpt-image-1.5") {
          const size = w > h ? "1536x1024" : w < h ? "1024x1536" : "1024x1024";
          const input: Record<string, unknown> = { prompt: req.prompt, image_size: size, quality: "high", num_images: 1 };
          if (ref) input.image_urls = req.referenceImages;
          return { endpoint, input };
        }
        // GPT Image 2.5 / 2.6 (Flare / Sunburst): tamanho explícito, múltiplo de 16
        const r16 = (n: number) => Math.max(1024, Math.round(n / 16) * 16);
        const scale = Math.min(1, 2048 / Math.max(w, h));
        const input: Record<string, unknown> = { prompt: req.prompt, image_size: { width: r16(w * scale), height: r16(h * scale) }, quality: "high", reasoning_effort: "low", num_images: 1 };
        if (ref) input.image_urls = req.referenceImages;
        return { endpoint, input };
      }
      case "upscale":
        return {
          endpoint: f.endpoint!,
          input: {
            image_url: req.imageUrl,
            upscale_factor: req.factor ?? 2,
            creativity: req.creativity ?? 0.35,
            resemblance: req.resemblance ?? 0.6,
            prompt: req.prompt ?? "masterpiece, best quality, highres, detailed skin and fabric texture",
          },
        };
      case "lipsync":
        return { endpoint: f.endpoint!, input: { video_url: req.videoUrl, audio_url: req.audioUrl, model: req.pro ? "lipsync-2-pro" : "lipsync-2", sync_mode: "cut_off" } };
      case "avatar": {
        if (f.family === "omnihuman") {
          return { endpoint: f.endpoint!, input: { image_url: req.imageUrl, audio_url: req.audioUrl, prompt: req.prompt ?? "", resolution: req.resolution ?? "1080p" } };
        }
        return { endpoint: f.endpoint!, input: { image_url: req.imageUrl, audio_url: req.audioUrl, prompt: req.prompt ?? "." } };
      }
      default:
        throw new ProviderError(this.name, `tipo ${(req as any).kind} não suportado`);
    }
  }

  async submit(req: GenerationRequest): Promise<SubmitResult> {
    const m = this.modelFor(req);
    const { endpoint, input } = this.build(req, m);
    const out = await this.http<{ request_id: string; status_url: string; response_url: string }>(`https://queue.fal.run/${endpoint}`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    const id = `fal:${out.request_id}`;
    this.jobs.set(id, { statusUrl: out.status_url, responseUrl: out.response_url, kind: req.kind });
    return { providerJobId: id, estimatedCostUsd: this.estimateCost(req) };
  }

  async poll(providerJobId: string): Promise<PollResult> {
    const j = this.jobs.get(providerJobId);
    if (!j) return { status: "failed", error: "job fal desconhecido (processo reiniciou?)" };
    const st = await this.http<FalStatus>(`${j.statusUrl}?logs=0`);
    if (st.status === "IN_QUEUE") return { status: "queued" };
    if (st.status === "IN_PROGRESS") return { status: "running" };
    const res = await this.http<{ video?: { url: string }; image?: { url: string; content_type?: string }; images?: { url: string; content_type?: string }[]; duration?: number }>(j.responseUrl);
    this.jobs.delete(providerJobId);
    if (j.kind === "video" || j.kind === "avatar" || j.kind === "lipsync") {
      if (!res.video?.url) return { status: "failed", error: `sem vídeo na resposta: ${JSON.stringify(res).slice(0, 300)}` };
      return { status: "succeeded", outputUrl: res.video.url, contentType: "video/mp4", usage: res.duration ? { seconds: res.duration } : undefined };
    }
    const img = res.image ?? res.images?.[0];
    if (!img?.url) return { status: "failed", error: `sem imagem na resposta: ${JSON.stringify(res).slice(0, 300)}` };
    return { status: "succeeded", outputUrl: img.url, contentType: img.content_type ?? "image/png" };
  }

  async download(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new ProviderError(this.name, `download ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
