import { createHash } from "node:crypto";
import { type AudioRequest, type GenerationRequest, type MediaKind, type PollResult, type Provider, type SfxRequest, type SubmitResult, ProviderError } from "../types.js";

/**
 * ElevenLabs — o narrador padrão da G2 no Higgsfield (v4), clonagem instantânea de voz
 * e efeitos sonoros (o papel do Mirelo).
 * Docs: https://elevenlabs.io/docs/api-reference
 * Conta própria (ELEVENLABS_API_KEY). Plano Starter (US$ 5/mês) libera Instant Voice Cloning.
 * Preço aproximado: ~US$ 0,30 por 1k caracteres (varia por plano); SFX ~US$ 0,05 por efeito.
 */

export interface ElevenLabsConfig {
  apiKey: string;
  /** id do modelo TTS (ex.: eleven_v3 / eleven_multilingual_v2) */
  model?: string;
  /** voz padrão quando não há referência */
  defaultVoiceId?: string;
}

type Alignment = { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };

const BASE = "https://api.elevenlabs.io/v1";

export class ElevenLabsProvider implements Provider {
  readonly name = "elevenlabs";
  private results = new Map<string, PollResult>();
  /** hash do áudio de referência → voice_id clonado (evita clonar de novo a cada narração) */
  private clones = new Map<string, string>();

  constructor(private cfg: ElevenLabsConfig) {
    if (!cfg.apiKey) throw new ProviderError(this.name, "ELEVENLABS_API_KEY ausente");
  }

  supports(kind: MediaKind) {
    return kind === "audio" || kind === "sfx";
  }

  estimateCost(req: GenerationRequest): number {
    if (req.kind === "audio") return +((req.text.length / 1000) * 0.3).toFixed(4);
    if (req.kind === "sfx") return 0.05;
    return 0;
  }

  private headers(extra: Record<string, string> = {}) {
    return { "xi-api-key": this.cfg.apiKey, ...extra };
  }

  private async fail(res: Response, what: string): Promise<never> {
    const text = await res.text();
    let msg = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      msg = j.detail?.message ?? j.detail?.status ?? j.detail ?? msg;
    } catch {
      /* texto */
    }
    throw new ProviderError(this.name, `${what}: ${res.status} ${typeof msg === "string" ? msg : JSON.stringify(msg)}`, res.status);
  }

  /** Instant Voice Cloning a partir de um áudio (URL pública ou data URL) */
  private async cloneVoice(ref: { audioUrl?: string; audioData?: string }, name: string): Promise<string> {
    const src = ref.audioData ?? ref.audioUrl!;
    const key = createHash("sha1").update(src.slice(0, 4000) + src.length).digest("hex");
    const cached = this.clones.get(key);
    if (cached) return cached;
    let bytes: Uint8Array;
    let mime = "audio/mpeg";
    if (src.startsWith("data:")) {
      const m = /^data:([^;]+);base64,(.*)$/s.exec(src);
      if (!m) throw new ProviderError(this.name, "áudio de referência inválido");
      mime = m[1];
      bytes = Uint8Array.from(Buffer.from(m[2], "base64"));
    } else {
      const r = await fetch(src);
      if (!r.ok) throw new ProviderError(this.name, `não baixei o áudio de referência (${r.status})`);
      mime = r.headers.get("content-type") ?? mime;
      bytes = new Uint8Array(await r.arrayBuffer());
    }
    const form = new FormData();
    form.append("name", name.slice(0, 60));
    form.append("remove_background_noise", "true");
    form.append("files", new Blob([bytes as BlobPart], { type: mime }), `ref.${mime.includes("wav") ? "wav" : "mp3"}`);
    const res = await fetch(`${BASE}/voices/add`, { method: "POST", headers: this.headers(), body: form });
    if (!res.ok) await this.fail(res, "clonar voz");
    const out = (await res.json()) as { voice_id: string };
    this.clones.set(key, out.voice_id);
    return out.voice_id;
  }

  private async tts(req: AudioRequest): Promise<PollResult> {
    let voiceId = req.voiceRef?.speaker ?? this.cfg.defaultVoiceId ?? "JBFqnCBsd6RMkjVDRZzb"; // "George" — narrador neutro
    if (req.voiceRef?.audioUrl || req.voiceRef?.audioData) voiceId = await this.cloneVoice(req.voiceRef, `g2-${Date.now()}`);

    // dicas do nosso guia: estabilidade 0,8 e semelhança 0,9 evitam sotaque estrangeiro
    const body = {
      text: req.text,
      model_id: this.cfg.model ?? "eleven_v3",
      language_code: (req.language ?? "pt").slice(0, 2),
      voice_settings: { stability: 0.8, similarity_boost: 0.9, style: 0.2, use_speaker_boost: true, speed: 1 + (req.speechRate ?? 0) / 200 },
    };
    const res = await fetch(`${BASE}/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) await this.fail(res, "narração");
    const out = (await res.json()) as { audio_base64: string; alignment?: Alignment; normalized_alignment?: Alignment };
    const bytes = Uint8Array.from(Buffer.from(out.audio_base64, "base64"));
    const subtitle = toSubtitle(req.text, out.alignment ?? out.normalized_alignment);
    const seconds = subtitle?.sentences.at(-1)?.end_time ? subtitle.sentences.at(-1)!.end_time / 1000 : req.text.length / 15;
    return { status: "succeeded", outputBytes: bytes, contentType: "audio/mpeg", usage: { seconds: +seconds.toFixed(2), characters: req.text.length }, meta: { subtitle, voiceId } };
  }

  private async sfx(req: SfxRequest): Promise<PollResult> {
    const res = await fetch(`${BASE}/sound-generation`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text: req.prompt, duration_seconds: Math.min(22, Math.max(0.5, req.durationSec ?? 5)), prompt_influence: 0.4 }),
    });
    if (!res.ok) await this.fail(res, "efeito sonoro");
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { status: "succeeded", outputBytes: bytes, contentType: "audio/mpeg", usage: { seconds: req.durationSec ?? 5 } };
  }

  async submit(req: GenerationRequest): Promise<SubmitResult> {
    const id = `el:${createHash("sha1").update(JSON.stringify(req) + Date.now()).digest("hex").slice(0, 16)}`;
    const r = req.kind === "audio" ? await this.tts(req) : req.kind === "sfx" ? await this.sfx(req) : null;
    if (!r) throw new ProviderError(this.name, `não gera ${req.kind}`);
    this.results.set(id, r);
    return { providerJobId: id, estimatedCostUsd: this.estimateCost(req) };
  }

  async poll(providerJobId: string): Promise<PollResult> {
    const r = this.results.get(providerJobId);
    if (!r) return { status: "failed", error: "job elevenlabs desconhecido (processo reiniciou?)" };
    this.results.delete(providerJobId);
    return r;
  }

  async download(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new ProviderError(this.name, `download ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

/** alinhamento por caractere → frases e palavras com start/end em ms (mesmo formato do Seed Audio) */
function toSubtitle(text: string, a?: Alignment) {
  if (!a?.characters?.length) return null;
  type W = { text: string; start_time: number; end_time: number };
  const words: W[] = [];
  let cur = "";
  let start = 0;
  for (let i = 0; i < a.characters.length; i++) {
    const ch = a.characters[i];
    if (/\s/.test(ch)) {
      if (cur) words.push({ text: cur, start_time: Math.round(start * 1000), end_time: Math.round(a.character_end_times_seconds[i - 1] * 1000) });
      cur = "";
    } else {
      if (!cur) start = a.character_start_times_seconds[i];
      cur += ch;
    }
  }
  if (cur) words.push({ text: cur, start_time: Math.round(start * 1000), end_time: Math.round(a.character_end_times_seconds.at(-1)! * 1000) });
  // frases: quebra em pontuação final
  const sentences: { text: string; start_time: number; end_time: number; words: W[] }[] = [];
  let bucket: W[] = [];
  for (const w of words) {
    bucket.push(w);
    if (/[.!?…]$/.test(w.text)) {
      sentences.push({ text: bucket.map((x) => x.text).join(" "), start_time: bucket[0].start_time, end_time: w.end_time, words: bucket });
      bucket = [];
    }
  }
  if (bucket.length) sentences.push({ text: bucket.map((x) => x.text).join(" "), start_time: bucket[0].start_time, end_time: bucket.at(-1)!.end_time, words: bucket });
  return { text, sentences };
}
