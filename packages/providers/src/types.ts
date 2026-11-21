/**
 * Contrato único para qualquer motor de geração (BytePlus, fal, Google...).
 * O app nunca fala com um provedor direto — só com esta interface.
 */

export type MediaKind = "image" | "video" | "audio" | "avatar" | "upscale" | "lipsync" | "sfx";

export interface ImageRequest {
  kind: "image";
  prompt: string;
  /** id do modelo no provedor (opcional; senão usa o padrão configurado) */
  model?: string;
  /** largura x altura, ex. "1440x2560" (9:16). Seedream 4.5 exige >= 3.686.400 px (2K) */
  size?: string;
  /** imagem(ns) de referência (URL pública) para edição/consistência */
  referenceImages?: string[];
  seed?: number;
}

export interface VideoRequest {
  kind: "video";
  prompt: string;
  /** id do modelo no provedor (opcional; senão escolhe pro/pro-fast automaticamente) */
  model?: string;
  /** primeiro frame (URL pública) — storyboard → animação */
  firstFrame?: string;
  /** último frame opcional (transição controlada) */
  lastFrame?: string;
  ratio?: "9:16" | "16:9" | "1:1" | "4:3" | "3:4" | "21:9";
  resolution?: "480p" | "720p" | "1080p";
  durationSec?: number;
  /** gerar áudio junto (modelos que suportam) */
  audio?: boolean;
  /** áudio de referência (narração pronta) — Seedance 2.5 anima a fala pela voz real */
  audioRef?: string;
  /** imagens extras de referência (personagem, cenário) — Seedance 2.x omni */
  referenceImages?: string[];
  seed?: number;
}

export interface AudioRequest {
  kind: "audio";
  /** texto a ser falado (ou prompt descritivo de cena sonora) */
  text: string;
  /** referência de voz: URL pública, data URL base64 ou id de speaker */
  voiceRef?: { audioUrl?: string; audioData?: string; speaker?: string };
  /** instruções de estilo em linguagem natural (emoção, ritmo, sotaque) */
  style?: string;
  speechRate?: number; // -50..100
  pitch?: number; // -12..12
  format?: "mp3" | "wav";
  /** pede timestamps por palavra (legenda sincronizada) */
  subtitles?: boolean;
  /** idioma falado: pt-BR (padrão), en, es, it, fr, de, ja — a instrução pro modelo vai nessa língua */
  language?: string;
}

/** clone de pessoa: foto + áudio (voz clonada) → vídeo da pessoa falando */
export interface AvatarRequest {
  kind: "avatar";
  model?: string;
  imageUrl: string;
  audioUrl: string;
  prompt?: string;
  resolution?: "720p" | "1080p";
  /** duração do áudio em segundos (pra estimar custo antes de gerar) */
  audioSec?: number;
}

/** upscale criativo (estilo Magnific) */
export interface UpscaleRequest {
  kind: "upscale";
  model?: string;
  imageUrl: string;
  factor?: number; // 1–4
  creativity?: number; // 0–1
  resemblance?: number; // 0–1
  prompt?: string;
  /** megapixels da imagem de entrada (pra estimar custo) */
  inputMp?: number;
}

/** lip-sync num vídeo pronto (plano B da boca) */
export interface LipsyncRequest {
  kind: "lipsync";
  model?: string;
  videoUrl: string;
  audioUrl: string;
  pro?: boolean;
  /** duração do vídeo em segundos (estimativa) */
  videoSec?: number;
}

/** efeito sonoro de uma ação (foley) */
export interface SfxRequest {
  kind: "sfx";
  model?: string;
  prompt: string;
  /** 0,5–22 s no ElevenLabs; até 120 s no Seed Audio (prompt com "music"/"trilha" vira música instrumental) */
  durationSec?: number;
}

export type GenerationRequest = ImageRequest | VideoRequest | AudioRequest | AvatarRequest | UpscaleRequest | LipsyncRequest | SfxRequest;

export interface SubmitResult {
  /** id do job no provedor */
  providerJobId: string;
  /** custo estimado em USD (para a guarda de custo / créditos) */
  estimatedCostUsd: number;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface PollResult {
  status: JobStatus;
  /** URL temporária do resultado (expira — baixar logo) */
  outputUrl?: string;
  /** bytes do resultado quando o provedor devolve inline (ex.: áudio base64) */
  outputBytes?: Uint8Array;
  /** tipo MIME do resultado, quando conhecido */
  contentType?: string;
  /** metadados extras (ex.: legendas com timestamps) */
  meta?: Record<string, unknown>;
  /** tokens / unidades consumidas, quando o provedor informa */
  usage?: Record<string, number>;
  error?: string;
}

export interface Provider {
  readonly name: string;
  /** quais tipos de mídia este provedor atende */
  supports(kind: MediaKind): boolean;
  /** estimativa ANTES de gastar — usada pela guarda de custo */
  estimateCost(req: GenerationRequest): number;
  submit(req: GenerationRequest): Promise<SubmitResult>;
  poll(providerJobId: string): Promise<PollResult>;
  /** baixa o resultado para bytes (URLs dos provedores expiram em horas) */
  download(url: string): Promise<Uint8Array>;
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number,
    public body?: unknown,
  ) {
    super(`[${provider}] ${message}`);
  }
}
