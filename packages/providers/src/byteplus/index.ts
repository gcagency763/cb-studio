import {
  type AvatarRequest,
  type GenerationRequest,
  type MediaKind,
  type ImageRequest,
  type PollResult,
  type Provider,
  type SubmitResult,
  type VideoRequest,
  ProviderError,
} from "../types.js";

/**
 * BytePlus ModelArk — Seedance (vídeo) e Seedream (imagem).
 * Docs: https://docs.byteplus.com/en/docs/ModelArk/
 *
 * Preços (USD / K tokens) — tabela do console em 09/11/2026:
 *   seedance-1-0-pro        0.0025   (texto→vídeo e imagem→vídeo)
 *   seedance-1-0-pro-fast   0.0010   (só imagem→vídeo)
 *   seedance-2-5            0.0107–0.0117 (exige fundo de reserva US$ 30)
 * Tokens de vídeo ≈ largura × altura × 24 fps × segundos / 1024.
 */

export interface BytePlusConfig {
  apiKey: string;
  baseUrl?: string;
  videoModel?: string;
  videoModelFast?: string;
  imageModel?: string;
  /** conta tem Free Credits Only Mode ligado → custo real 0 até acabar cota */
  freeCreditsOnly?: boolean;
  /** libera Seedance 2.x (exige US$ 30 de fundo de reserva pagos no console) */
  allowReserveFund?: boolean;
}

const PRICE_PER_K_TOKENS: Record<string, number> = {
  "seedance-1-0-pro": 0.0025,
  "seedance-1-0-pro-fast": 0.001,
  // com som 0,0024; a gente gera sem (a voz é a narração do projeto)
  "seedance-1-5-pro": 0.0012,
  "dreamina-seedance-2-5": 0.0117,
  "dreamina-seedance-2-0": 0.0077,
  "dreamina-seedance-2-0-fast": 0.0056,
  "dreamina-seedance-2-0-mini": 0.0035,
};
/** modelos que exigem o fundo de reserva (US$ 30) — bloqueados até o usuário liberar via env */
export const RESERVE_FUND_MODELS = /^dreamina-seedance-2/;

const IMAGE_PRICE_USD: Record<string, number> = {
  "seedream-4-0": 0.03,
  "seedream-4-5": 0.04,
  "seedream-5-0-lite": 0.035,
  "seedream-5-0-flash": 0.018,
  "seedream-5-0-pro": 0.09,
};

const RES_HEIGHT: Record<NonNullable<VideoRequest["resolution"]>, number> = {
  "480p": 480,
  "720p": 720,
  "1080p": 1080,
};

function ratioToWH(ratio: NonNullable<VideoRequest["ratio"]>, shortSide: number) {
  const [a, b] = ratio.split(":").map(Number);
  const landscape = a >= b;
  const long = Math.round((shortSide * Math.max(a, b)) / Math.min(a, b));
  return landscape ? { w: long, h: shortSide } : { w: shortSide, h: long };
}

function priceKeyFor(model: string): string {
  // "seedance-1-0-pro-fast-251015" → "seedance-1-0-pro-fast"
  return model.replace(/-\d{6}$/, "");
}

export class BytePlusProvider implements Provider {
  readonly name = "byteplus";
  private baseUrl: string;
  private videoModel: string;
  private videoModelFast: string;
  private imageModel: string;

  constructor(private cfg: BytePlusConfig) {
    if (!cfg.apiKey) throw new ProviderError(this.name, "ARK_API_KEY ausente");
    this.baseUrl = (cfg.baseUrl ?? "https://ark.ap-southeast.bytepluses.com/api/v3").replace(/\/$/, "");
    this.videoModel = cfg.videoModel ?? "seedance-1-0-pro-250528";
    this.videoModelFast = cfg.videoModelFast ?? "seedance-1-0-pro-fast-251015";
    this.imageModel = cfg.imageModel ?? "seedream-4-5-251128";
  }

  supports(kind: MediaKind) {
    return kind === "image" || kind === "video" || kind === "avatar";
  }

  private pickVideoModel(req: VideoRequest) {
    if (req.model) return req.model;
    // pro-fast é 2,5× mais barato mas só aceita imagem→vídeo
    return req.firstFrame ? this.videoModelFast : this.videoModel;
  }

  estimateCost(req: GenerationRequest): number {
    if (req.kind === "avatar") return this.estimateCost(this.avatarToVideo(req));
    if (req.kind === "image") {
      return IMAGE_PRICE_USD[priceKeyFor(req.model ?? this.imageModel)] ?? 0.04;
    }
    if (req.kind !== "video") return 0;
    const res = req.resolution ?? "480p";
    const ratio = req.ratio ?? "9:16";
    const dur = req.durationSec ?? 5;
    const { w, h } = ratioToWH(ratio, RES_HEIGHT[res]);
    const tokens = (w * h * 24 * dur) / 1024;
    const model = this.pickVideoModel(req);
    const key = priceKeyFor(model);
    const price = key === "seedance-1-5-pro" && req.audio ? 0.0024 : PRICE_PER_K_TOKENS[key] ?? 0.0025;
    return +((tokens / 1000) * price).toFixed(4);
  }

  // ───────────────────────────── HTTP ─────────────────────────────

  private async http<T>(path: string, init: RequestInit = {}): Promise<T> {
    // sem prazo, uma conexão que trava deixa o job "na fila" pra sempre e ocupa uma vaga do worker:
    // geração de imagem é síncrona (até ~1 min com referências) → 4 min; o resto (criar/consultar tarefa) → 1 min
    const ms = /\/images\//.test(path) ? 240_000 : 60_000;
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(ms),
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* texto puro */
    }
    if (!res.ok) {
      const msg = (body as any)?.error?.message ?? res.statusText;
      throw new ProviderError(this.name, `${res.status} ${msg}`, res.status, body);
    }
    return body as T;
  }

  // ───────────────────────────── submit ─────────────────────────────

  async submit(req: GenerationRequest): Promise<SubmitResult> {
    if (req.kind === "image") return this.submitImage(req);
    if (req.kind === "video") return this.submitVideo(req);
    // clone de pessoa: foto + narração → Seedance 2.5 anima a fala pela voz real
    if (req.kind === "avatar") return this.submitVideo(this.avatarToVideo(req));
    throw new ProviderError(this.name, `não gera ${req.kind}`);
  }

  private avatarToVideo(req: AvatarRequest): VideoRequest {
    const sec = Math.min(30, Math.max(4, Math.ceil((req.audioSec ?? 10) + 0.5)));
    return {
      kind: "video",
      model: req.model && /seedance-2/.test(req.model) ? req.model : "dreamina-seedance-2-5-260628",
      prompt: `${req.prompt ?? "A pessoa de @Image1 fala olhando para a câmera, expressiva, gestos naturais."} A fala segue exatamente o áudio @Audio1, com os lábios sincronizados.`,
      referenceImages: [req.imageUrl],
      audioRef: req.audioUrl,
      ratio: "9:16",
      resolution: req.resolution ?? "720p",
      durationSec: sec,
      audio: true,
    };
  }

  private async submitVideo(req: VideoRequest): Promise<SubmitResult> {
    const model = this.pickVideoModel(req);
    if (RESERVE_FUND_MODELS.test(model) && !this.cfg.allowReserveFund) {
      throw new ProviderError(this.name, `${model} exige fundo de reserva (US$ 30) na BytePlus — ative com ARK_ALLOW_SEEDANCE_2=true depois de pagar`);
    }
    // Seedance 2.x gera áudio nativo quando pedido
    const audioFlag = RESERVE_FUND_MODELS.test(model) && req.audio ? " --generate_audio true" : "";
    // Seedance aceita parâmetros inline no texto
    const flags = [
      `--ratio ${req.ratio ?? "9:16"}`,
      `--resolution ${req.resolution ?? "480p"}`,
      `--duration ${req.durationSec ?? 5}`,
      `--watermark false`,
      req.seed != null ? `--seed ${req.seed}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const content: any[] = [{ type: "text", text: `${req.prompt} ${flags}${audioFlag}` }];
    if (req.firstFrame) {
      content.push({ type: "image_url", image_url: { url: req.firstFrame }, role: "first_frame" });
    }
    if (req.lastFrame) {
      content.push({ type: "image_url", image_url: { url: req.lastFrame }, role: "last_frame" });
    }
    // Seedance 2.x "omni": imagens de referência (personagem/cenário) e áudio de referência (fala)
    for (const url of req.referenceImages ?? []) content.push({ type: "image_url", image_url: { url }, role: "reference_image" });
    if (req.audioRef) content.push({ type: "audio_url", audio_url: { url: req.audioRef }, role: "reference_audio" });

    // 1.5 em diante: parâmetros no corpo (o texto inline "--ratio" é do 1.0); som desligado salvo pedido
    const modern = /seedance-1-5/.test(model);
    if (modern) content[0].text = req.prompt;
    const extra = modern
      ? { ratio: req.ratio ?? "9:16", resolution: req.resolution ?? "480p", duration: req.durationSec ?? 5, watermark: false, generate_audio: !!req.audio, ...(req.seed != null ? { seed: req.seed } : {}) }
      : {};
    const out = await this.http<{ id: string }>("/contents/generations/tasks", {
      method: "POST",
      body: JSON.stringify({ model, content, ...extra }),
    });
    return { providerJobId: `video:${out.id}`, estimatedCostUsd: this.estimateCost(req) };
  }

  /**
   * Imagem é síncrona na ModelArk. Guardamos o resultado em memória e
   * devolvemos um pseudo-job para manter o contrato submit/poll uniforme.
   */
  private imageResults = new Map<string, PollResult>();

  private async submitImage(req: ImageRequest): Promise<SubmitResult> {
    const body: Record<string, unknown> = {
      model: req.model ?? this.imageModel,
      prompt: req.prompt,
      size: req.size ?? "1440x2560",
      response_format: "url",
      watermark: false,
    };
    if (req.referenceImages?.length) body.image = req.referenceImages;
    if (req.seed != null) body.seed = req.seed;

    const id = `image:${crypto.randomUUID()}`;
    try {
      const out = await this.http<{ data: { url: string }[]; usage?: Record<string, number> }>(
        "/images/generations",
        { method: "POST", body: JSON.stringify(body) },
      );
      this.imageResults.set(id, {
        status: "succeeded",
        outputUrl: out.data?.[0]?.url,
        usage: out.usage,
      });
    } catch (e: any) {
      this.imageResults.set(id, { status: "failed", error: e.message });
    }
    return { providerJobId: id, estimatedCostUsd: this.estimateCost(req) };
  }

  // ───────────────────────────── poll ─────────────────────────────

  async poll(providerJobId: string): Promise<PollResult> {
    if (providerJobId.startsWith("image:")) {
      const r = this.imageResults.get(providerJobId);
      if (!r) return { status: "failed", error: "job de imagem desconhecido (processo reiniciou?)" };
      return r;
    }
    const id = providerJobId.replace(/^video:/, "");
    const out = await this.http<{
      status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
      content?: { video_url?: string };
      usage?: Record<string, number>;
      error?: { message?: string };
    }>(`/contents/generations/tasks/${id}`);

    if (out.status === "succeeded") {
      return { status: "succeeded", outputUrl: out.content?.video_url, usage: out.usage };
    }
    if (out.status === "failed" || out.status === "cancelled") {
      return { status: "failed", error: out.error?.message ?? out.status };
    }
    return { status: out.status };
  }

  async download(url: string): Promise<Uint8Array> {
    const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new ProviderError(this.name, `download ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
