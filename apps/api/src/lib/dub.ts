import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { sql } from "./db.js";
import { burnCaptions, probeSize, targetSize, type Format, type Transcript, type TSegment } from "./edit.js";
import { env } from "./env.js";
import { providers } from "./generate.js";
import { chatJson } from "./llm.js";
import { ffmpegBin, materialize, probeDuration, run } from "./render.js";
import { resolveLocalRef } from "./refs.js";
import { putObject } from "./storage.js";

/**
 * Dublagem grátis (sem ElevenLabs): Whisper transcreve → Seed 2.1 traduz trecho a trecho
 * mantendo a duração falada → Seed Audio fala na língua-alvo com a voz do próprio vídeo
 * (clone a partir de 20 s do áudio original) → FFmpeg encaixa cada trecho no tempo certo,
 * acelera até 30% se não couber, troca a faixa de áudio e (opcional) queima a legenda traduzida.
 * Sem boca refeita (isso é o lipsync pago, fal.ai).
 */
export type DubLanguage = "pt-BR" | "en" | "es" | "it" | "fr" | "de" | "ja";
export const LANG_NAME: Record<DubLanguage, string> = { "pt-BR": "português do Brasil", en: "inglês americano", es: "espanhol latino neutro", it: "italiano", fr: "francês", de: "alemão", ja: "japonês" };

export interface DubOptions {
  language: DubLanguage;
  /** "same" clona a voz do vídeo · "default" voz padrão do Seed Audio · id de uma voz cadastrada */
  voice?: string;
  captions?: boolean;
  format?: Format;
  context?: string;
  /** volume do áudio original por baixo (0 = troca completa; 0.1 deixa ambiente/música bem baixo) */
  bedVolume?: number;
}

interface Chunk { i: number; start: number; end: number; text: string; translated?: string }

/** junta segmentos curtos em trechos de ~4–12 s (uma chamada de TTS por trecho) */
export function chunkSegments(segs: TSegment[]): Chunk[] {
  const out: Chunk[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    const gap = last ? s.start - last.end : 99;
    if (last && gap < 0.8 && last.end - last.start < 6 && s.end - last.start <= 14) {
      last.end = s.end;
      last.text = `${last.text} ${s.text}`.trim();
    } else out.push({ i: out.length, start: s.start, end: s.end, text: s.text.trim() });
  }
  return out.filter((c) => c.text);
}

const trSchema = z.object({ items: z.array(z.object({ i: z.number(), text: z.string() })) });

/** traduz os trechos mantendo a duração falada (pra caber no tempo do vídeo) */
export async function translateChunks(chunks: Chunk[], language: DubLanguage, context?: string) {
  const BATCH = 25;
  for (let b = 0; b < chunks.length; b += BATCH) {
    const slice = chunks.slice(b, b + BATCH);
    const system =
      language === "pt-BR"
        ? `Você prepara falas pra regravação em português do Brasil. Para cada trecho, devolva o mesmo texto limpo pra ser lido por um narrador: tire vícios ("né", "tipo", "ééé"), repetições e gaguejos, corrija concordância, mantenha o sentido, o tom e aproximadamente a mesma duração falada (dur em segundos). ${context ? `Contexto: ${context}` : ""}
Responda SÓ em JSON: {"items":[{"i":<índice>,"text":"<fala>"}]}`
        : `Você é dublador-tradutor profissional. Traduza cada trecho de português do Brasil para ${LANG_NAME[language]}, natural e falado (não literal), mantendo sentido, tom e energia de venda. REGRA DE OURO: a tradução precisa caber na mesma duração falada — "dur" é o tempo em segundos do trecho original; ajuste o tamanho da frase (um locutor fala ~2,6 palavras/s em inglês, ~2,8 em espanhol). Mantenha nomes, marcas (Shopee, Mercado Livre), números e moedas como estão. ${context ? `Contexto do vídeo: ${context}` : ""}
Responda SÓ em JSON: {"items":[{"i":<índice>,"text":"<tradução>"}]}`;
    const user = JSON.stringify(slice.map((c) => ({ i: c.i, dur: +(c.end - c.start).toFixed(1), words: c.text.split(/\s+/).length, text: c.text })));
    const { json } = await chatJson<z.infer<typeof trSchema>>(system, user, { temperature: 0.3, maxTokens: 4000 });
    const parsed = trSchema.parse(json);
    for (const it of parsed.items) {
      const c = chunks.find((x) => x.i === it.i);
      if (c && it.text.trim()) c.translated = it.text.trim();
    }
  }
  for (const c of chunks) if (!c.translated) c.translated = c.text;
}

/** 20 s mais limpos do próprio locutor (trechos de fala contínua) → referência de voz em base64 */
async function voiceSample(bin: string, src: string, work: string, segs: TSegment[]): Promise<string> {
  const runs: { start: number; end: number }[] = [];
  for (const s of segs) {
    const last = runs[runs.length - 1];
    if (last && s.start - last.end < 0.5 && s.end - last.start <= 20) last.end = s.end;
    else runs.push({ start: s.start, end: s.end });
  }
  const best = runs.sort((a, b) => b.end - b.start - (a.end - a.start))[0] ?? { start: 0, end: 20 };
  const len = Math.min(20, Math.max(3, best.end - best.start));
  const out = join(work, "voice.wav");
  await run(bin, ["-hide_banner", "-y", "-ss", String(best.start.toFixed(2)), "-t", String(len.toFixed(2)), "-i", src, "-vn", "-ac", "1", "-ar", "24000", "-af", "highpass=f=80,lowpass=f=12000,loudnorm=I=-18:TP=-2", "-c:a", "pcm_s16le", out]);
  return `data:audio/wav;base64,${(await readFile(out)).toString("base64")}`;
}

/** segundos de voz grátis que ainda cabem (Seed Audio) */
export async function voiceSecondsLeft(): Promise<number> {
  const [row] = await sql<{ secs: string | null }[]>`select coalesce(sum((usage->>'seconds')::numeric), 0) as secs from jobs where kind in ('audio','dub','sfx') and provider = 'seedaudio' and status = 'succeeded'`;
  return env.VOICE_FREE_MINUTES * 60 - Number(row?.secs ?? 0);
}

export interface DubResult { key: string; url: string; durationSec: number; chunks: number; voiceSeconds: number; language: DubLanguage; transcript: Transcript; translation: string }

export async function dubVideo(videoRef: string, transcript: Transcript, opt: DubOptions, outKey: string, onProgress?: (p: { step: string }) => void): Promise<DubResult> {
  const seed = providers.seedaudio;
  if (!seed) throw new Error("Seed Audio não configurado (ARK_API_KEY)");
  const bin = ffmpegBin();
  const work = join(tmpdir(), `g2dub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await mkdir(work, { recursive: true });
  try {
    const chunks = chunkSegments(transcript.segments);
    if (!chunks.length) throw new Error("nenhuma fala encontrada na transcrição");
    const speechSec = chunks.reduce((a, c) => a + (c.end - c.start), 0);
    const left = await voiceSecondsLeft();
    if (speechSec > left) throw new Error(`a dublagem precisa de ~${Math.ceil(speechSec / 60)} min de voz e só restam ${Math.max(0, Math.floor(left / 60))} min grátis — suba VOICE_FREE_MINUTES no .env (cobra US$ 0,15/min)`);

    onProgress?.({ step: opt.language === "pt-BR" ? "limpando as falas" : `traduzindo pra ${LANG_NAME[opt.language]}` });
    await translateChunks(chunks, opt.language, opt.context);

    const src = await materialize(videoRef, join(work, "src"));
    const videoDur = await probeDuration(bin, src);

    let voiceRef: { audioData?: string; audioUrl?: string } | undefined;
    const voice = opt.voice ?? "same";
    if (voice === "same") {
      onProgress?.({ step: "capturando a voz do vídeo" });
      voiceRef = { audioData: await voiceSample(bin, src, work, transcript.segments) };
    } else if (voice !== "default") {
      const [v] = await sql<{ reference_url: string }[]>`select reference_url from voices where id = ${voice}`;
      if (!v) throw new Error("voz não encontrada");
      const data = await resolveLocalRef(v.reference_url);
      voiceRef = data?.startsWith("data:") ? { audioData: data } : { audioUrl: data };
    }

    // ── TTS trecho a trecho ──
    const parts: { file: string; dur: number; pos: number; tempo: number; sub: any }[] = [];
    let voiceSeconds = 0;
    let prevEnd = 0;
    for (const [n, c] of chunks.entries()) {
      onProgress?.({ step: `falando ${n + 1}/${chunks.length}` });
      const { providerJobId } = await seed.submit({ kind: "audio", text: c.translated!, voiceRef, language: opt.language, format: "wav", subtitles: true });
      const r = await seed.poll(providerJobId);
      if (r.status !== "succeeded" || !r.outputBytes) throw new Error(`Seed Audio no trecho ${n + 1}: ${r.error ?? "sem áudio"}`);
      const file = join(work, `p${n}.wav`);
      await writeFile(file, r.outputBytes);
      const dur = (r.meta as any)?.durationSec ?? (await probeDuration(bin, file));
      voiceSeconds += (r.usage as any)?.seconds ?? dur;
      // encaixe: começa no tempo original (ou logo depois do trecho anterior); acelera até 1.3× se não couber até o próximo
      const pos = Math.max(c.start, prevEnd + 0.08);
      const next = chunks[n + 1]?.start ?? videoDur;
      const slot = Math.max(0.5, next - pos);
      const tempo = dur > slot * 1.04 ? Math.min(1.3, dur / slot) : 1;
      const fitted = dur / tempo;
      parts.push({ file, dur: fitted, pos, tempo, sub: (r.meta as any)?.subtitle ?? null });
      prevEnd = pos + fitted;
    }

    // ── faixa dublada: cada trecho no seu tempo ──
    onProgress?.({ step: "montando o áudio" });
    const totalDur = Math.max(videoDur, prevEnd + 0.3);
    const inputs: string[] = [];
    const filters: string[] = [];
    parts.forEach((p, i) => {
      inputs.push("-i", p.file);
      const ms = Math.round(p.pos * 1000);
      filters.push(`[${i}:a]${p.tempo !== 1 ? `atempo=${p.tempo.toFixed(3)},` : ""}aresample=48000,aformat=channel_layouts=mono,adelay=${ms}|${ms}[a${i}]`);
    });
    const bed = Math.max(0, Math.min(0.5, opt.bedVolume ?? 0));
    let mixIn = parts.map((_, i) => `[a${i}]`).join("");
    let count = parts.length;
    if (bed > 0) {
      inputs.push("-i", src);
      filters.push(`[${parts.length}:a]aresample=48000,aformat=channel_layouts=mono,volume=${bed}[bed]`);
      mixIn += "[bed]";
      count += 1;
    }
    filters.push(`${mixIn}amix=inputs=${count}:normalize=0:dropout_transition=0,apad=whole_dur=${totalDur.toFixed(2)},atrim=0:${totalDur.toFixed(2)}[mix]`);
    const dubWav = join(work, "dub.wav");
    await run(bin, ["-hide_banner", "-y", ...inputs, "-filter_complex", filters.join(";"), "-map", "[mix]", "-c:a", "pcm_s16le", dubWav]);

    // ── troca a faixa (estende o último quadro se a fala passou do fim) ──
    onProgress?.({ step: "trocando o áudio" });
    const muxed = join(work, "dubbed.mp4");
    const extra = totalDur - videoDur;
    if (extra > 0.25) {
      await run(bin, ["-hide_banner", "-y", "-i", src, "-i", dubWav, "-filter_complex", `[0:v]tpad=stop_mode=clone:stop_duration=${extra.toFixed(2)}[v]`, "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", muxed]);
    } else {
      await run(bin, ["-hide_banner", "-y", "-i", src, "-i", dubWav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", muxed]);
    }

    // transcrição na língua-alvo com os tempos finais (legenda, .srt, biblioteca)
    const segments: TSegment[] = parts.map((p, i) => {
      const words = (p.sub?.sentences ?? []).flatMap((s: any) => s.words ?? []).map((w: any) => ({ start: +(p.pos + w.start_time / 1000 / p.tempo).toFixed(3), end: +(p.pos + w.end_time / 1000 / p.tempo).toFixed(3), text: String(w.text).trim() })).filter((w: any) => w.text);
      const text = chunks[i].translated!;
      if (!words.length) {
        // sem timestamps do provedor: distribui as palavras no trecho
        const ws = text.split(/\s+/).filter(Boolean);
        const step = p.dur / Math.max(1, ws.length);
        ws.forEach((t, k) => words.push({ start: +(p.pos + k * step).toFixed(3), end: +(p.pos + (k + 1) * step).toFixed(3), text: t }));
      }
      return { start: p.pos, end: +(p.pos + p.dur).toFixed(3), text, words };
    });
    const dubbed: Transcript = { language: opt.language, durationSec: +totalDur.toFixed(2), text: segments.map((s) => s.text).join(" "), segments, model: "seed-audio-1.0" };

    let finalFile = muxed;
    let durationSec = totalDur;
    if (opt.captions !== false) {
      onProgress?.({ step: "legenda" });
      const r = await burnCaptions(bin, muxed, work, "out", dubbed, null, { format: opt.format ?? "original", captionStyle: "karaoke", uppercase: true, cutSilence: false, zooms: false, broll: 0 });
      finalFile = r.file;
      durationSec = r.durationSec;
    } else if (opt.format && opt.format !== "original") {
      onProgress?.({ step: "reenquadrando" });
      const { w, h } = await probeSize(bin, muxed);
      const size = targetSize(opt.format, w, h);
      finalFile = join(work, "out.mp4");
      await run(bin, ["-hide_banner", "-y", "-i", muxed, "-vf", `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height},setsar=1`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", finalFile]);
    }
    const stored = await putObject(outKey, await readFile(finalFile), "video/mp4");
    return { ...stored, durationSec, chunks: chunks.length, voiceSeconds: +voiceSeconds.toFixed(1), language: opt.language, transcript: dubbed, translation: chunks.map((c) => c.translated).join("\n") };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
