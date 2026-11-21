import { type AudioRequest, type GenerationRequest, type MediaKind, type PollResult, type Provider, type SubmitResult, ProviderError } from "../types.js";

/**
 * BytePlus Seed Speech — Seed Audio 1.0 (o motor de voz que o Higgsfield usa).
 * Docs: https://docs.byteplus.com/en/docs/byteplusvoice/seedaudio-01
 *
 * - HTTP síncrono, até 120 s de áudio por chamada, 3.000 caracteres
 * - Português brasileiro suportado
 * - Clonagem: referência de voz por áudio (URL ou base64, até 30 s / 10 MB), citada no prompt como @Audio1
 * - enable_subtitle → timestamps por frase e por palavra (legenda sincronizada)
 * - Cota: 60 minutos grátis na conta (nov/2026). Preço pós-cota a confirmar no console.
 */

export interface SeedAudioConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** USD por minuto de áudio gerado (estimativa para a guarda de custo) */
  pricePerMinuteUsd?: number;
}

type SeedAudioResponse = {
  code?: number;
  message?: string;
  audio?: string;
  duration?: number;
  original_duration?: number;
  url?: string;
  subtitle?: { text: string; sentences: { start_time: number; end_time: number; text: string; words?: { start_time: number; end_time: number; text: string }[] }[] };
};

/** instruções por idioma (o Seed Audio é multilíngue; a instrução vai na língua-alvo) */
const LANG: Record<string, { clone: string; speak: string }> = {
  "pt-br": { clone: "Use a voz e o timbre de @Audio1.", speak: "Fale em português do Brasil, natural" },
  pt: { clone: "Use a voz e o timbre de @Audio1.", speak: "Fale em português do Brasil, natural" },
  en: { clone: "Use the voice and timbre of @Audio1.", speak: "Speak in natural, fluent American English" },
  "en-us": { clone: "Use the voice and timbre of @Audio1.", speak: "Speak in natural, fluent American English" },
  es: { clone: "Usa la voz y el timbre de @Audio1.", speak: "Habla en español latino neutro, natural" },
  it: { clone: "Usa la voce e il timbro di @Audio1.", speak: "Parla in italiano naturale" },
  fr: { clone: "Utilise la voix et le timbre de @Audio1.", speak: "Parle en français naturel" },
  de: { clone: "Verwende die Stimme und den Klang von @Audio1.", speak: "Sprich in natürlichem Deutsch" },
  ja: { clone: "@Audio1の声と音色を使ってください。", speak: "自然な日本語で話してください" },
};

export class SeedAudioProvider implements Provider {
  readonly name = "seedaudio";
  private results = new Map<string, PollResult>();
  private baseUrl: string;
  private model: string;
  private pricePerMinute: number;

  constructor(private cfg: SeedAudioConfig) {
    if (!cfg.apiKey) throw new ProviderError(this.name, "SEED_SPEECH_API_KEY (ou ARK_API_KEY) ausente");
    this.baseUrl = (cfg.baseUrl ?? "https://voice.ap-southeast-1.bytepluses.com/api/v3").replace(/\/$/, "");
    this.model = cfg.model ?? "seed-audio-1.0";
    this.pricePerMinute = cfg.pricePerMinuteUsd ?? 0.03;
  }

  supports(kind: MediaKind) {
    return kind === "audio" || kind === "sfx";
  }

  estimateCost(req: GenerationRequest): number {
    if (req.kind === "sfx") return +(((req.durationSec ?? 5) / 60) * this.pricePerMinute).toFixed(4);
    if (req.kind !== "audio") return 0;
    // ~15 caracteres/segundo em pt-BR falado
    const seconds = Math.max(2, req.text.length / 15);
    return +((seconds / 60) * this.pricePerMinute).toFixed(4);
  }

  async submit(req: GenerationRequest): Promise<SubmitResult> {
    if (req.kind !== "audio" && req.kind !== "sfx") throw new ProviderError(this.name, "só gera áudio");
    const id = `audio:${crypto.randomUUID()}`;

    const references: Record<string, string>[] = [];
    let prompt: string;
    if (req.kind === "sfx") {
      // efeito sonoro / ambiente: o Seed Audio gera som de cena sem fala (mesma cota grátis)
      const dur = Math.min(120, Math.max(1, req.durationSec ?? 5));
      const music = /\b(music|trilha|música|musica|beat|soundtrack|instrumental)\b/i.test(req.prompt);
      prompt = music
        ? `Instrumental music only — no speech, no voice, no singing, no lyrics. Compose ${dur} seconds of ${req.prompt.trim()}. Consistent tempo and key, clean mix, loopable, fades out at the end.`
        : `Sound design only — no speech, no voice, no singing, no music with vocals. Generate a ${dur}-second sound effect: ${req.prompt.trim()}. Clean, realistic, ends naturally.`;
      return this.call(id, prompt, [], req, "sfx");
    }
    prompt = req.text.trim();
    const L = LANG[(req.language ?? "pt-BR").toLowerCase()] ?? LANG["pt-br"];
    if (req.voiceRef?.audioData || req.voiceRef?.audioUrl || req.voiceRef?.speaker) {
      const ref: Record<string, string> = {};
      if (req.voiceRef.audioData) ref.audio_data = req.voiceRef.audioData.replace(/^data:[^;]+;base64,/, "");
      else if (req.voiceRef.audioUrl) ref.audio_url = req.voiceRef.audioUrl;
      else if (req.voiceRef.speaker) ref.speaker = req.voiceRef.speaker;
      references.push(ref);
      const style = req.style ? ` ${req.style.trim()}.` : "";
      prompt = `${L.clone}${style} ${L.speak}: "${prompt}"`;
    } else if (req.style) {
      prompt = `${req.style.trim()}. ${L.speak}: "${prompt}"`;
    } else if (req.language && L !== LANG["pt-br"]) {
      prompt = `${L.speak}: "${prompt}"`;
    }

    return this.call(id, prompt, references, req, "audio");
  }

  private async call(id: string, prompt: string, references: Record<string, string>[], req: AudioRequest | { kind: "sfx"; prompt: string; durationSec?: number }, mode: "audio" | "sfx"): Promise<SubmitResult> {
    const speech = req.kind === "audio" ? req : null;
    const body = {
      model: this.model,
      text_prompt: prompt,
      ...(references.length ? { references } : {}),
      audio_config: {
        // sempre WAV: o mp3 do Seed Audio sai quase mudo no ffmpeg-static (build do macOS);
        // o wav é maior, mas decodifica certo em qualquer ffmpeg
        format: "wav",
        sample_rate: 24000,
        speech_rate: speech?.speechRate ?? 0,
        pitch_rate: speech?.pitch ?? 0,
        loudness_rate: 0,
        enable_subtitle: mode === "audio" ? (speech?.subtitles ?? true) : false,
      },
      watermark: {},
    };

    try {
      const res = await fetch(`${this.baseUrl}/tts/create`, {
        method: "POST",
        headers: { "X-Api-Key": this.cfg.apiKey, "X-Api-Request-Id": crypto.randomUUID(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      const text = await res.text();
      let out: SeedAudioResponse = {};
      try {
        out = JSON.parse(text);
      } catch {
        /* não-JSON */
      }
      if (!res.ok || (out.code != null && out.code !== 0 && out.code !== 200 && out.code !== 20000000) || !out.audio) {
        const msg = out.message ?? text.slice(0, 300) ?? res.statusText;
        throw new ProviderError(this.name, `${res.status} ${msg}`, res.status, out);
      }
      this.results.set(id, {
        status: "succeeded",
        outputBytes: new Uint8Array(Buffer.from(out.audio, "base64")),
        outputUrl: out.url,
        contentType: "audio/wav",
        usage: { seconds: out.original_duration ?? out.duration ?? 0 },
        meta: { durationSec: out.duration ?? out.original_duration, subtitle: out.subtitle ?? null },
      });
    } catch (e: any) {
      this.results.set(id, { status: "failed", error: e.message });
    }
    return { providerJobId: id, estimatedCostUsd: this.estimateCost(req as GenerationRequest) };
  }

  async poll(providerJobId: string): Promise<PollResult> {
    return this.results.get(providerJobId) ?? { status: "failed", error: "job de áudio desconhecido (processo reiniciou?)" };
  }

  async download(url: string): Promise<Uint8Array> {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new ProviderError(this.name, `download ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
