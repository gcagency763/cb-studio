import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { env } from "./env.js";
import { chatJson } from "./llm.js";
import { assColor, assHeader, assTime, buildAss, defaults, escapeAss, ffmpegBin, materialize, probeDuration, run, wrap, type RenderOptions, type RenderSentence } from "./render.js";
import { cropExpr, faceTrack, panKeyframes } from "./reframe.js";
import { putObject } from "./storage.js";

/**
 * Edição de vídeo gravado — tudo local e grátis:
 *   transcribe: vídeo → transcrição com timestamps por palavra (Whisper no Docker)
 *   caption:    vídeo + transcrição → legenda karaokê queimada (estilo G2), 9:16 opcional
 *   cuts:       transcrição → Seed 2.1 escolhe os melhores trechos → clipes legendados
 */

export interface TWord { start: number; end: number; text: string; /** vício de linguagem ("ééé", "hum", "né" de muleta, repetição) marcado na revisão */ filler?: boolean }
export interface TSegment { start: number; end: number; text: string; words: TWord[] }
export interface Transcript { language: string; durationSec: number; text: string; segments: TSegment[]; model: string }

export type Format = "9:16" | "original" | "1:1" | "16:9";

const WHISPER_URL = (process.env.WHISPER_URL ?? "http://localhost:9000").replace(/\/$/, "");
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE ?? "pt";

// ─────────────────────────── transcrição ───────────────────────────

/** o serviço Whisper está no ar? (sobe com `docker compose up -d whisper`) */
export async function whisperHealthy(): Promise<boolean> {
  try {
    const r = await fetch(`${WHISPER_URL}/docs`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
let starting: number | null = null;

/**
 * Sobe o serviço whisper do docker-compose sozinho (OrbStack/Docker no Mac) — a API e o
 * worker chamam isso ao iniciar e a página Cortes chama quando vê o serviço fora.
 * A primeira vez baixa a imagem (~1,8 GB); o log fica em .logs/whisper.log.
 */
export async function ensureWhisper(): Promise<{ healthy: boolean; starting: boolean }> {
  if (await whisperHealthy()) {
    starting = null;
    return { healthy: true, starting: false };
  }
  if (starting && Date.now() - starting < 10 * 60_000) return { healthy: false, starting: true };
  starting = Date.now();
  try {
    await mkdir(join(ROOT, ".logs"), { recursive: true });
    const log = openSync(join(ROOT, ".logs", "whisper.log"), "a");
    const home = homedir();
    const child = spawn("docker", ["compose", "up", "-d", "whisper"], {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, PATH: `/usr/local/bin:/opt/homebrew/bin:${home}/.orbstack/bin:${process.env.PATH ?? ""}` },
    });
    child.on("error", (e) => console.error("[whisper] não consegui rodar docker compose:", e.message));
    child.unref();
  } catch (e: any) {
    console.error("[whisper] falha ao subir:", e.message);
    starting = null;
    return { healthy: false, starting: false };
  }
  return { healthy: false, starting: true };
}

/** vídeo/áudio → wav 16k mono (o Whisper trabalha melhor assim e o upload fica pequeno) */
async function toWav16k(bin: string, src: string, dest: string) {
  await run(bin, ["-hide_banner", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", dest]);
}

export async function transcribe(videoRef: string, onProgress?: (p: { step: string }) => void): Promise<Transcript> {
  // espera o serviço subir (até 12 min — a 1ª vez baixa a imagem do Docker)
  for (let i = 0; i < 72 && !(await whisperHealthy()); i++) {
    await ensureWhisper();
    onProgress?.({ step: i === 0 ? "subindo transcrição" : `subindo transcrição (${i * 10}s)` });
    await new Promise((r) => setTimeout(r, 10_000));
  }
  if (!(await whisperHealthy())) throw new Error("serviço de transcrição não subiu — o Docker (OrbStack) está aberto? veja .logs/whisper.log");
  const bin = ffmpegBin();
  const work = join(tmpdir(), `g2tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await mkdir(work, { recursive: true });
  try {
    onProgress?.({ step: "áudio" });
    const src = await materialize(videoRef, join(work, "src"));
    const dur = await probeDuration(bin, src);
    const wav = join(work, "audio.wav");
    await toWav16k(bin, src, wav);

    onProgress?.({ step: "whisper" });
    const fd = new FormData();
    fd.append("audio_file", new Blob([(await readFile(wav)) as BlobPart], { type: "audio/wav" }), "audio.wav");
    const q = new URLSearchParams({ task: "transcribe", language: WHISPER_LANGUAGE, output: "json", word_timestamps: "true", vad_filter: "true", encode: "false" });
    const res = await fetch(`${WHISPER_URL}/asr?${q}`, { method: "POST", body: fd, signal: AbortSignal.timeout(60 * 60_000) });
    if (!res.ok) throw new Error(`whisper ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body: any = await res.json();

    const segments: TSegment[] = (body.segments ?? [])
      .map((s: any) => ({
        start: +s.start,
        end: +s.end,
        text: String(s.text ?? "").trim(),
        words: (s.words ?? [])
          .map((w: any) => ({ start: +w.start, end: +w.end, text: String(w.word ?? w.text ?? "").trim() }))
          .filter((w: TWord) => w.text),
      }))
      .filter((s: TSegment) => s.text);
    const t: Transcript = { language: body.language ?? WHISPER_LANGUAGE, durationSec: +dur.toFixed(2), text: String(body.text ?? segments.map((s) => s.text).join(" ")).trim(), segments, model: process.env.WHISPER_MODEL ?? "small" };
    if (process.env.WHISPER_POLISH !== "false") {
      onProgress?.({ step: "revisando a transcrição" });
      await polishTranscript(t).catch((e) => console.warn("[transcribe] revisão pulada:", e.message));
    }
    return t;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Seed 2.1 corrige erros típicos do Whisper (homófonos: "sinto"→"cinto", nomes, termos de e-commerce)
 * palavra por palavra, mantendo os tempos. Lotes de ~300 palavras.
 */
export async function polishTranscript(t: Transcript, context?: string) {
  const words = t.segments.flatMap((s) => s.words);
  if (!words.length) return;
  const BATCH = 300;
  for (let b = 0; b < words.length; b += BATCH) {
    const slice = words.slice(b, b + BATCH);
    const numbered = slice.map((w, i) => `${i}:${w.text}`).join(" ");
    const system = `Você revisa transcrições automáticas em português do Brasil de vídeos da G2 Educação (e-commerce, Shopee, vendas, marketing). Corrija SÓ erros claros de transcrição: homófonos ("sinto"→"cinto" quando é objeto), nomes (Shopee, Mercado Livre, Cirilo), números, termos de marketing. Não reescreva, não mude o sentido, não junte nem separe palavras: uma palavra corrigida substitui exatamente uma palavra.
Marque também em "fillers" os índices das palavras que são só vício de linguagem e saem sem perder sentido: "é"/"éé"/"ééé" usado como muleta (NUNCA o verbo), "hum", "hmm", "ahn", "ãh", "né" no fim de frase, "tipo"/"assim" quando é muleta, palavras repetidas por gaguejo ("eu eu eu" → marque as repetidas), falsos começos. Em dúvida, não marque.
${context ? `Contexto do vídeo: ${context}` : ""}
Responda SÓ em JSON: {"fixes":[{"i":<índice>,"text":"<palavra corrigida>"}],"fillers":[<índices>]} (listas vazias se não houver).`;
    const { json } = await chatJson<{ fixes?: { i: number; text: string }[]; fillers?: number[] }>(system, numbered, { temperature: 0, maxTokens: 1500 });
    for (const f of json.fixes ?? []) {
      const w = slice[f.i];
      if (w && typeof f.text === "string" && f.text.trim() && !/\s/.test(f.text.trim())) w.text = f.text.trim();
    }
    for (const i of json.fillers ?? []) if (typeof i === "number" && slice[i]) slice[i].filler = true;
  }
  for (const s of t.segments) s.text = s.words.map((w) => w.text).join(" ");
  t.text = t.segments.map((s) => s.text).join(" ");
}

export async function saveTranscript(key: string, t: Transcript) {
  return putObject(key, new TextEncoder().encode(JSON.stringify(t)), "application/json");
}

export async function loadTranscript(ref: string): Promise<Transcript> {
  const work = join(tmpdir(), `g2tr-${Date.now()}`);
  await mkdir(work, { recursive: true });
  try {
    const p = await materialize(ref, join(work, "t.json"));
    return JSON.parse(await readFile(p, "utf8")) as Transcript;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// ─────────────────────────── legenda estilo G2 ───────────────────────────

/**
 * Palavras → frases curtas de legenda (até ~5 palavras / 26 caracteres / 2,6 s),
 * quebrando em pausas — o ritmo das legendas que seguram atenção (Submagic/Captions).
 * Tempos em segundos relativos a `offset`.
 */
export function chunkWords(words: TWord[], offset = 0, opt = { maxWords: 5, maxChars: 26, maxDur: 2.6, gap: 0.55 }): RenderSentence[] {
  const out: RenderSentence[] = [];
  let cur: TWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({
      start_time: Math.round((cur[0].start - offset) * 1000),
      end_time: Math.round((cur[cur.length - 1].end - offset) * 1000),
      text: cur.map((w) => w.text).join(" "),
      words: cur.map((w) => ({ start_time: Math.round((w.start - offset) * 1000), end_time: Math.round((w.end - offset) * 1000), text: w.text })),
    });
    cur = [];
  };
  for (const w of words) {
    const last = cur[cur.length - 1];
    const chars = cur.reduce((a, x) => a + x.text.length + 1, 0) + w.text.length;
    const dur = cur.length ? w.end - cur[0].start : 0;
    const pause = last ? w.start - last.end : 0;
    const endsSentence = last ? /[.!?…]$/.test(last.text) : false;
    if (cur.length && (cur.length >= opt.maxWords || chars > opt.maxChars || dur > opt.maxDur || pause > opt.gap || endsSentence)) flush();
    cur.push(w);
  }
  flush();
  return out;
}

/** palavras do transcript dentro de [start, end] */
export function wordsBetween(t: Transcript, start: number, end: number): TWord[] {
  const out: TWord[] = [];
  for (const s of t.segments) {
    if (s.end < start || s.start > end) continue;
    for (const w of s.words) if (w.start >= start - 0.05 && w.end <= end + 0.05) out.push(w);
  }
  return out;
}

export interface CaptionOptions {
  format?: Format;
  fontSize?: number;
  uppercase?: boolean;
  captionStyle?: "karaoke" | "sentence";
  highlightColor?: string;
  /** título (gancho) nos primeiros segundos, no topo */
  title?: string;
  titleSec?: number;
  /** edição automática: tira pausas/silêncios (gaps > 0,7 s entre palavras) */
  cutSilence?: boolean;
  /** edição automática: zoom suave nas frases (punch-in a cada ~3 frases e nas frases com ! ? números) */
  zooms?: boolean;
  /** b-roll gerado: até N imagens (Seedream, cota grátis) inseridas nas frases com objeto/cena/número */
  broll?: number;
  /** estilo das imagens de b-roll (chave de STYLES do roteirista; padrão cinematic = fotorrealista) */
  brollStyle?: string;
  /** contexto pra escolher o b-roll */
  context?: string;
  /** b-roll já gerado (tempo no vídeo original) — se vier, não escolhe nem gera de novo */
  brollReady?: BrollClip[];
  /** reenquadre ao cortar pra 9:16/1:1: "face" segue quem fala (padrão), "center" corta o centro fixo */
  reframe?: "face" | "center";
  /** edição automática: tira "ééé", "hum", "né" de muleta e repetições (marcados na revisão da transcrição) */
  cutFillers?: boolean;
  /** marca d'água: logo (PNG) no canto — vem de Provedores → Marca; false desliga */
  logo?: BrandLogo | false;
}

export interface BrandLogo { url: string; position?: "top-left" | "top-right" | "bottom-left" | "bottom-right"; size?: number; opacity?: number }

/** expressão do overlay do logo: canto + margem de 3% (em 9:16 o canto de baixo fica acima da legenda) */
export function logoOverlay(l: BrandLogo, W: number, H: number, format: Format) {
  const m = Math.round(W * 0.03);
  const bottom = format === "9:16" ? Math.round(H * 0.3) : Math.round(H * 0.16);
  const pos = l.position ?? "top-right";
  const x = pos.endsWith("left") ? `${m}` : `W-w-${m}`;
  const y = pos.startsWith("top") ? `${m}` : `H-h-${bottom}`;
  return `overlay=${x}:${y}:format=auto`;
}

export interface BrollPick { start: number; end: number; prompt: string; label: string }
export interface BrollClip extends BrollPick { imageUrl: string }

/* ───── edição automática: silêncios e zooms ───── */

export interface Keep { a: number; b: number }

/** intervalos de fala (tempo do vídeo) a partir das palavras; o resto é pausa e sai */
export function speechIntervals(words: TWord[], range: { start: number; end: number }, gap = 0.7, pad = 0.22): Keep[] {
  if (!words.length) return [{ a: range.start, b: range.end }];
  const out: Keep[] = [];
  let cur: Keep = { a: Math.max(range.start, words[0].start - pad), b: words[0].end + pad };
  for (const w of words.slice(1)) {
    if (w.start - cur.b > gap) {
      out.push(cur);
      cur = { a: w.start - pad, b: w.end + pad };
    } else cur.b = Math.max(cur.b, w.end + pad);
  }
  out.push(cur);
  // limites e sem sobreposição
  const fixed: Keep[] = [];
  for (const k of out) {
    const a = Math.max(range.start, fixed.length ? Math.max(k.a, fixed[fixed.length - 1].b) : k.a);
    const b = Math.min(range.end, k.b);
    if (b - a > 0.05) fixed.push({ a, b });
  }
  return fixed;
}

/** tempo no vídeo original → tempo no vídeo sem pausas */
/** tira trechos (ex.: vícios de linguagem) de dentro dos intervalos mantidos */
export function subtractIntervals(keeps: Keep[], cuts: Keep[]): Keep[] {
  let out = keeps;
  for (const c of cuts) {
    const next: Keep[] = [];
    for (const k of out) {
      if (c.b <= k.a || c.a >= k.b) next.push(k);
      else {
        if (c.a - k.a > 0.05) next.push({ a: k.a, b: c.a });
        if (k.b - c.b > 0.05) next.push({ a: c.b, b: k.b });
      }
    }
    out = next;
  }
  return out;
}

export function remapTime(keeps: Keep[], t: number): number {
  let acc = 0;
  for (const k of keeps) {
    if (t <= k.a) return acc;
    if (t <= k.b) return acc + (t - k.a);
    acc += k.b - k.a;
  }
  return acc;
}

function betweenExpr(keeps: Keep[]) {
  return keeps.map((k) => `between(t,${k.a.toFixed(3)},${k.b.toFixed(3)})`).join("+");
}

/** frases que ganham zoom (tempo já no vídeo final) */
export function zoomIntervals(sentences: RenderSentence[]): Keep[] {
  const out: Keep[] = [];
  sentences.forEach((s, i) => {
    const strong = /[!?]|\d/.test(s.text) || i % 3 === 2;
    if (strong) out.push({ a: s.start_time / 1000, b: s.end_time / 1000 + 0.1 });
  });
  // junta vizinhas e limita a 60 (expressão do ffmpeg)
  const merged: Keep[] = [];
  for (const z of out) {
    const last = merged[merged.length - 1];
    if (last && z.a - last.b < 0.3) last.b = z.b;
    else merged.push({ ...z });
  }
  return merged.slice(0, 60);
}

export function targetSize(format: Format, w: number, h: number): { width: number; height: number } {
  if (format === "9:16") return { width: 1080, height: 1920 };
  if (format === "1:1") return { width: 1080, height: 1080 };
  if (format === "16:9") return { width: 1920, height: 1080 };
  // original: mantém proporção, limita a 1080 no menor lado
  const scale = Math.min(1, 1080 / Math.min(w, h));
  return { width: Math.round((w * scale) / 2) * 2, height: Math.round((h * scale) / 2) * 2 };
}

export async function probeSize(bin: string, file: string): Promise<{ w: number; h: number }> {
  const text = await run(bin, ["-hide_banner", "-i", file]).catch((e: Error) => e.message);
  const m = /Video:.*?\s(\d{2,5})x(\d{2,5})/.exec(text);
  return m ? { w: +m[1], h: +m[2] } : { w: 1920, h: 1080 };
}

/** estilo extra: título/gancho no topo */
function titleAss(title: string, sec: number, o: Required<RenderOptions>) {
  const size = Math.round(o.fontSize * 1.15);
  const style = `Style: Hook,${o.fontName},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,8,70,70,${Math.round(o.height * 0.12)},1\n`;
  const line = `Dialogue: 1,${assTime(0)},${assTime(sec)},Hook,,0,0,0,,{\\fad(150,250)}{\\c${assColor(o.highlightColor)}}${escapeAss(wrap(title.toUpperCase(), 22))}`;
  return { style, line };
}

/**
 * Corta [start,end] (ou o vídeo inteiro), reenquadra e queima a legenda karaokê.
 * Devolve o caminho do MP4 gerado dentro de `work`.
 */
export async function burnCaptions(
  bin: string,
  src: string,
  work: string,
  name: string,
  transcript: Transcript,
  range: { start: number; end: number } | null,
  opt: CaptionOptions,
): Promise<{ file: string; durationSec: number }> {
  const format = opt.format ?? "9:16";
  const { w, h } = await probeSize(bin, src);
  const size = targetSize(format, w, h);
  const start = range?.start ?? 0;
  const end = range?.end ?? transcript.durationSec;
  const o: Required<RenderOptions> = { ...defaults, width: size.width, height: size.height, fontSize: opt.fontSize ?? (format === "9:16" ? 72 : 56), uppercase: opt.uppercase ?? true, captionStyle: opt.captionStyle ?? "karaoke", highlightColor: opt.highlightColor ?? defaults.highlightColor, marginBottom: Math.round(size.height * (format === "9:16" ? 0.17 : 0.08)) };

  const all = wordsBetween(transcript, start, end);
  // vícios de linguagem marcados na revisão: saem da legenda e (se tiverem ≥ 0,25 s) do vídeo
  const fillers = opt.cutFillers ? all.filter((wd) => wd.filler) : [];
  const words = opt.cutFillers ? all.filter((wd) => !wd.filler) : all;
  // edição automática: tira pausas (e vícios) → o tempo das palavras é remapeado pro vídeo compactado
  let keeps: Keep[] = opt.cutSilence ? speechIntervals(words, { start, end }) : [{ a: start, b: end }];
  if (fillers.length) keeps = subtractIntervals(keeps, fillers.filter((f) => f.end - f.start >= 0.25).map((f) => ({ a: f.start - 0.02, b: f.end + 0.02 })));
  const compact = !!opt.cutSilence || (keeps.length > 1 || (keeps.length === 1 && (keeps[0].a > start + 0.01 || keeps[0].b < end - 0.01)));
  const dur = +keeps.reduce((acc, k) => acc + (k.b - k.a), 0).toFixed(2);
  const mapped = compact ? words.map((wd) => ({ ...wd, start: remapTime(keeps, wd.start), end: remapTime(keeps, wd.end) })) : words;
  const sentences = chunkWords(mapped, compact ? 0 : start);
  let ass = buildAss("", dur, o, sentences);
  if (opt.title) {
    const t = titleAss(opt.title, Math.min(dur, opt.titleSec ?? 3), o);
    ass = ass.replace("\n[Events]", `${t.style}\n[Events]`).trimEnd() + "\n" + t.line + "\n";
  }
  const assPath = join(work, `${name}.ass`);
  await writeFile(assPath, ass);

  const vf: string[] = [];
  const af: string[] = [];
  if (compact && keeps.length) {
    // tempos relativos ao começo do trecho (o -ss já cortou o início)
    const rel = keeps.map((k) => ({ a: k.a - start, b: k.b - start }));
    vf.push(`select='${betweenExpr(rel)}'`, "setpts=N/FRAME_RATE/TB");
    af.push(`aselect='${betweenExpr(rel)}'`, "asetpts=N/SR/TB");
  }
  // reenquadre: cobre o alvo e corta — seguindo o rosto de quem fala (pico + keyframes de pan) ou o centro fixo
  const f = Math.max(size.width / w, size.height / h);
  const scaled = { w: Math.round(w * f), h: Math.round(h * f) };
  let cropXY = "";
  if (opt.reframe !== "center" && (scaled.w - size.width > 8 || scaled.h - size.height > 8)) {
    const samples = await faceTrack(bin, src, { w, h }, range, { fps: end - start > 1200 ? 1 : 2 });
    const keys = panKeyframes(samples);
    if (keys.length) {
      // tempo das amostras é relativo ao começo do trecho; com pausas tiradas, remapeia pro vídeo compactado
      const mapT = (ts: number) => (compact ? remapTime(keeps, start + ts) : ts);
      cropXY = `:x='${cropExpr(keys, "x", scaled.w, size.width, mapT)}':y='${cropExpr(keys, "y", scaled.h, size.height, mapT)}'`;
    }
  }
  vf.push(`scale=${size.width}:${size.height}:force_original_aspect_ratio=increase`, `crop=${size.width}:${size.height}${cropXY}`);
  if (opt.zooms) {
    const zs = zoomIntervals(sentences);
    if (zs.length) {
      // punch-in de 8% nas frases marcadas: amplia por frame (scale com eval=frame) e corta o centro
      const z = `(1+0.08*(${betweenExpr(zs)}))`;
      vf.push(`scale=w='trunc(${size.width}*${z}/2)*2':h='trunc(${size.height}*${z}/2)*2':eval=frame`, `crop=${size.width}:${size.height}`);
    }
  }
  vf.push(`fps=${o.fps}`, `setsar=1`);
  const subs = `subtitles='${assPath.replace(/\\/g, "/").replace(/:/g, "\\:")}'`;

  // b-roll: imagens geradas entram por cima do vídeo nos trechos escolhidos (tempo já do vídeo final)
  const brolls = (opt.brollReady ?? []).filter((b) => b.end > start && b.start < end);
  const brollFiles: string[] = [];
  for (let i = 0; i < brolls.length; i++) brollFiles.push(await materialize(brolls[i].imageUrl, join(work, `${name}-broll${i}`)));

  const logo = opt.logo && opt.logo.url ? opt.logo : null;
  const logoFile = logo ? await materialize(logo.url, join(work, `${name}-logo`)).catch(() => null) : null;

  const out = join(work, `${name}.mp4`);
  const args = ["-hide_banner", "-y"];
  if (range) args.push("-ss", start.toFixed(3), "-to", end.toFixed(3));
  args.push("-i", src);
  if (brolls.length || logoFile) {
    for (const f of brollFiles) args.push("-loop", "1", "-framerate", String(o.fps), "-t", (dur + 1).toFixed(2), "-i", f);
    const parts: string[] = [`[0:v]${vf.join(",")}[v0]`];
    let cur = "v0";
    brolls.forEach((b, i) => {
      const a = compact ? remapTime(keeps, Math.max(b.start, start)) : Math.max(b.start, start) - start;
      const e = compact ? remapTime(keeps, Math.min(b.end, end)) : Math.min(b.end, end) - start;
      parts.push(`[${i + 1}:v]scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height},setsar=1[b${i}]`);
      parts.push(`[${cur}][b${i}]overlay=enable='between(t,${a.toFixed(2)},${e.toFixed(2)})':eof_action=pass[v${i + 1}]`);
      cur = `v${i + 1}`;
    });
    if (logoFile) {
      const li = brolls.length + 1;
      args.push("-i", logoFile);
      const lw = Math.round(size.width * Math.min(0.4, Math.max(0.05, logo!.size ?? 0.14)));
      parts.push(`[${li}:v]scale=${lw}:-1,format=rgba,colorchannelmixer=aa=${Math.min(1, Math.max(0.1, logo!.opacity ?? 0.85)).toFixed(2)}[lg]`);
      parts.push(`[${cur}][lg]${logoOverlay(logo!, size.width, size.height, format)}[vl]`);
      cur = "vl";
    }
    parts.push(`[${cur}]${subs}[vout]`);
    if (af.length) parts.push(`[0:a]${af.join(",")}[aout]`);
    args.push("-filter_complex", parts.join(";"), "-map", "[vout]", "-map", af.length ? "[aout]" : "0:a:0");
  } else {
    args.push("-vf", `${vf.join(",")},${subs}`);
    if (af.length) args.push("-af", af.join(","));
  }
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", out);
  await run(bin, args);
  return { file: out, durationSec: dur };
}

// ─────────────────────────── b-roll gerado ───────────────────────────

const brollSchema = z.object({ broll: z.array(z.object({ start: z.number(), end: z.number(), prompt: z.string(), label: z.string() })) });

/** Seed 2.1 escolhe onde entra uma imagem (objeto, lugar, número, metáfora) e escreve o prompt. */
export async function pickBroll(t: Transcript, range: { start: number; end: number }, opt: { max: number; style?: string; context?: string }): Promise<BrollPick[]> {
  const segs = t.segments.filter((s) => s.end > range.start && s.start < range.end);
  if (!segs.length || opt.max <= 0) return [];
  const lines = segs.map((s) => `[${s.start.toFixed(1)}–${s.end.toFixed(1)}] ${s.text}`).join("\n").slice(0, 60_000);
  const styleText = STYLE_HINT[opt.style ?? "cinematic"] ?? STYLE_HINT.cinematic;
  const system = `Você é editor de vídeo da G2 Educação (e-commerce/Shopee, Brasil). No trecho transcrito abaixo (tempos em segundos), escolha até ${opt.max} momentos pra entrar um B-ROLL (imagem ilustrativa) de 1,8 a 3 s: frases com objeto, lugar, número, cena ou metáfora que uma imagem reforça. Nunca nos 3 primeiros segundos; pelo menos 8 s entre um e outro; o b-roll começa junto com a frase que ilustra.
Pra cada um, escreva o prompt da imagem em inglês: "${styleText}", depois a cena concreta (sem texto na imagem, sem rostos de pessoas reais, sem logos). ${opt.context ? `Contexto: ${opt.context}` : ""}
Responda SÓ em JSON: {"broll":[{"start":<seg>,"end":<seg>,"prompt":"<en>","label":"<2-4 palavras pt>"}]}`;
  const { json } = await chatJson(system, lines, { temperature: 0.5, maxTokens: 1500 });
  const picks = brollSchema.parse(json).broll
    .map((b) => ({ ...b, start: Math.max(range.start, b.start), end: Math.min(range.end, Math.max(b.start + 1.8, Math.min(b.end, b.start + 3))) }))
    .filter((b) => b.end - b.start >= 1.2 && b.start >= range.start + 3)
    .sort((a, b) => a.start - b.start);
  // espaçamento mínimo de 8 s
  const out: BrollPick[] = [];
  for (const b of picks) if (!out.length || b.start - out[out.length - 1].end >= 8) out.push(b);
  return out.slice(0, opt.max);
}

const STYLE_HINT: Record<string, string> = {
  cinematic: "Photorealistic cinematic still, 35mm film look, shallow depth of field, warm natural light",
  epic: "Painterly epic illustration, rich warm golden and deep blue palette, dramatic rim light, soft brush texture",
  comic: "Comic book style, bold ink outlines, halftone shading, dramatic lighting",
  anime: "Modern anime style, clean lineart, cel shading, expressive, detailed background",
  flat: "Flat vector illustration, bold shapes, limited palette, clean composition",
};

/** gera as imagens do b-roll (Seedream, cota grátis) e espera ficarem prontas — devolve só as que deram certo */
export async function generateBroll(picks: BrollPick[], format: Format, onProgress?: (s: string) => void): Promise<BrollClip[]> {
  if (!picks.length) return [];
  const { plan, guard, enqueue } = await import("./generate.js");
  const { getJob } = await import("./db.js");
  const size = format === "9:16" ? "1440x2560" : format === "1:1" ? "2048x2048" : "2560x1440";
  const jobs: { pick: BrollPick; jobId: string }[] = [];
  for (const pick of picks) {
    const request = { kind: "image" as const, prompt: pick.prompt, size, seed: Math.floor(Math.random() * 2_000_000_000), broll: true };
    const { provider, cost } = plan(request);
    await guard(request, provider, cost, false);
    const job = await enqueue(request, provider.name, cost, {});
    jobs.push({ pick, jobId: job.id });
  }
  const out: BrollClip[] = [];
  const until = Date.now() + 4 * 60_000;
  const pending = new Set(jobs.map((j) => j.jobId));
  while (pending.size && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000));
    onProgress?.(`b-roll ${jobs.length - pending.size}/${jobs.length}`);
    for (const j of jobs) {
      if (!pending.has(j.jobId)) continue;
      const row = await getJob(j.jobId);
      if (row?.status === "succeeded" && row.output_url) {
        out.push({ ...j.pick, imageUrl: row.output_url });
        pending.delete(j.jobId);
      } else if (row?.status === "failed") pending.delete(j.jobId);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export async function captionVideo(videoRef: string, transcript: Transcript, opt: CaptionOptions, outKey: string, onProgress?: (p: { step: string }) => void) {
  const bin = ffmpegBin();
  const work = join(tmpdir(), `g2cap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await mkdir(work, { recursive: true });
  try {
    let brollReady = opt.brollReady;
    if (!brollReady && (opt.broll ?? 0) > 0) {
      onProgress?.({ step: "escolhendo b-roll" });
      const picks = await pickBroll(transcript, { start: 0, end: transcript.durationSec }, { max: opt.broll!, style: opt.brollStyle, context: opt.context });
      brollReady = await generateBroll(picks, opt.format ?? "9:16", (st) => onProgress?.({ step: st }));
    }
    onProgress?.({ step: "legenda" });
    const src = await materialize(videoRef, join(work, "src"));
    const r = await burnCaptions(bin, src, work, "out", transcript, null, { ...opt, brollReady });
    const stored = await putObject(outKey, await readFile(r.file), "video/mp4");
    return { ...stored, durationSec: r.durationSec, broll: brollReady?.length ?? 0 };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// ─────────────────────────── cortes ───────────────────────────

export interface CutPick { start: number; end: number; title: string; hook: string; reason: string; score: number }
export interface CutsOptions { count?: number; minSec?: number; maxSec?: number; context?: string; format?: Format; language?: string; cutSilence?: boolean; cutFillers?: boolean; zooms?: boolean; broll?: number; brollStyle?: string; reframe?: "face" | "center"; logo?: BrandLogo | false }

const picksSchema = z.object({
  cuts: z.array(z.object({ start: z.number(), end: z.number(), title: z.string(), hook: z.string().optional().default(""), reason: z.string().optional().default(""), score: z.number().min(0).max(10) })).min(1),
});

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Seed 2.1 lê a transcrição com tempos e escolhe os trechos que viram cortes. */
export async function pickCuts(t: Transcript, opt: CutsOptions = {}): Promise<CutPick[]> {
  const count = opt.count ?? 6;
  const minSec = opt.minSec ?? 25;
  const maxSec = opt.maxSec ?? 70;
  // linhas "[m:ss–m:ss] texto" por segmento, enxuto pra caber no contexto
  const lines = t.segments.map((s) => `[${fmtTime(s.start)}–${fmtTime(s.end)}] ${s.text}`).join("\n").slice(0, 120_000);
  const system = `Você é editor de cortes virais da G2 Educação (educação em e-commerce / Shopee, público brasileiro).
Recebe a transcrição de um vídeo longo com os tempos de cada trecho e escolhe os ${count} melhores cortes autocontidos pra Reels/TikTok/Shorts.
Critérios: gancho forte nos 3 primeiros segundos, uma ideia só por corte, começa e termina em frase completa, tem promessa/revelação/número/história, sem depender do que veio antes.
Cada corte entre ${minSec} e ${maxSec} segundos. Use tempos (em segundos) que existam na transcrição; não invente conteúdo.
${opt.context ? `Contexto do vídeo: ${opt.context}` : ""}
Responda SÓ em JSON: {"cuts":[{"start":<seg>,"end":<seg>,"title":"<gancho de até 7 palavras, pra escrever na tela>","hook":"<primeira frase do corte>","reason":"<por que viraliza, 1 frase>","score":<0-10>}]} ordenados do melhor pro pior.`;
  const { json } = await chatJson(system, `Duração total: ${fmtTime(t.durationSec)}\n\n${lines}`, { temperature: 0.3, maxTokens: 3000 });
  const parsed = picksSchema.parse(json);
  // ajusta pra limites reais e pra começar/terminar em palavra
  const all = t.segments.flatMap((s) => s.words);
  const snap = (x: number, toStart: boolean) => {
    let best = x;
    let d = 0.8;
    for (const w of all) {
      const v = toStart ? w.start : w.end;
      if (Math.abs(v - x) < d) {
        d = Math.abs(v - x);
        best = v;
      }
    }
    return best;
  };
  return parsed.cuts
    .map((c) => ({ ...c, start: Math.max(0, snap(c.start, true) - 0.15), end: Math.min(t.durationSec, snap(c.end, false) + 0.25) }))
    .filter((c) => c.end - c.start >= Math.min(minSec, 15) && c.end - c.start <= maxSec + 15)
    .slice(0, count);
}

/** um corte só, com limites ajustados na mão (refazer) */
export async function renderOneCut(videoRef: string, t: Transcript, range: { start: number; end: number }, title: string | undefined, opt: CutsOptions, key: string, onProgress?: (p: { step: string }) => void) {
  const bin = ffmpegBin();
  const work = join(tmpdir(), `g2cut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await mkdir(work, { recursive: true });
  try {
    const src = await materialize(videoRef, join(work, "src"));
    let brollReady: BrollClip[] | undefined;
    if ((opt.broll ?? 0) > 0) {
      onProgress?.({ step: "escolhendo b-roll" });
      brollReady = await generateBroll(await pickBroll(t, range, { max: opt.broll!, style: opt.brollStyle, context: opt.context }), opt.format ?? "9:16", (st) => onProgress?.({ step: st }));
    }
    onProgress?.({ step: "corte" });
    const r = await burnCaptions(bin, src, work, "cut", t, range, { format: opt.format ?? "9:16", title, titleSec: 3, cutSilence: opt.cutSilence, cutFillers: opt.cutFillers, zooms: opt.zooms, brollReady, reframe: opt.reframe, logo: opt.logo });
    const stored = await putObject(key, await readFile(r.file), "video/mp4");
    return { ...stored, durationSec: r.durationSec };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function renderCuts(videoRef: string, t: Transcript, picks: CutPick[], opt: CutsOptions, keyPrefix: string, onProgress?: (p: { step: string; cut?: number; total?: number }) => void) {
  const bin = ffmpegBin();
  const work = join(tmpdir(), `g2cuts-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await mkdir(work, { recursive: true });
  try {
    const src = await materialize(videoRef, join(work, "src"));
    const out: { index: number; key: string; url: string; durationSec: number; pick: CutPick }[] = [];
    // b-roll de todos os cortes de uma vez (as imagens geram em paralelo)
    let brollAll: BrollClip[] = [];
    if ((opt.broll ?? 0) > 0) {
      onProgress?.({ step: "escolhendo b-roll" });
      const picksAll: BrollPick[] = [];
      for (const p of picks) picksAll.push(...(await pickBroll(t, { start: p.start, end: p.end }, { max: opt.broll!, style: opt.brollStyle, context: opt.context })));
      brollAll = await generateBroll(picksAll, opt.format ?? "9:16", (st) => onProgress?.({ step: st }));
    }
    for (let i = 0; i < picks.length; i++) {
      onProgress?.({ step: "corte", cut: i + 1, total: picks.length });
      const p = picks[i];
      const r = await burnCaptions(bin, src, work, `cut${i}`, t, { start: p.start, end: p.end }, { format: opt.format ?? "9:16", title: p.title, titleSec: 3, cutSilence: opt.cutSilence, cutFillers: opt.cutFillers, zooms: opt.zooms, brollReady: brollAll, reframe: opt.reframe, logo: opt.logo });
      const key = `${keyPrefix}-${String(i + 1).padStart(2, "0")}.mp4`;
      const stored = await putObject(key, await readFile(r.file), "video/mp4");
      out.push({ index: i + 1, key: stored.key, url: stored.url, durationSec: r.durationSec, pick: p });
    }
    return out;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export const editEnv = { whisperUrl: WHISPER_URL, model: process.env.WHISPER_MODEL ?? "small", language: WHISPER_LANGUAGE, storageDir: env.STORAGE_DIR };

// ─────────────────────────── vídeo de referência → roteiro ───────────────────────────

export interface ReferenceAnalysis {
  hook: string;
  structure: { beat: string; fromSec: number; toSec: number; purpose: string }[];
  cta: string;
  tone: string;
  pacing: string;
  whyItWorks: string;
  scenesSuggested: number;
}

/** Seed 2.1 lê a transcrição de um vídeo que performou e descreve a estrutura (pra recriar com outro tema). */
export async function analyzeReference(t: Transcript, context?: string): Promise<ReferenceAnalysis> {
  const lines = t.segments.map((s) => `[${fmtTime(s.start)}–${fmtTime(s.end)}] ${s.text}`).join("\n").slice(0, 60_000);
  const system = `Você é estrategista de criativos da G2 Educação (educação em e-commerce/Shopee, Brasil).
Analise a transcrição de um vídeo curto que performou e descreva a ESTRUTURA pra ser recriada com outro tema: gancho, batidas (beats) com tempo, função de cada batida, CTA, tom e ritmo.
${context ? `Contexto: ${context}` : ""}
Responda SÓ em JSON: {"hook":"<o gancho, 1 frase>","structure":[{"beat":"<nome>","fromSec":<n>,"toSec":<n>,"purpose":"<função>"}],"cta":"<chamada final>","tone":"<tom>","pacing":"<ritmo: frases por cena, duração média>","whyItWorks":"<2 frases>","scenesSuggested":<nº de cenas de vídeo pra recriar, 5-12>}`;
  const { json } = await chatJson<ReferenceAnalysis>(system, `Duração: ${fmtTime(t.durationSec)}\n\n${lines}`, { temperature: 0.3, maxTokens: 2000 });
  return json;
}

export function referenceToText(a: ReferenceAnalysis) {
  return [`Gancho: ${a.hook}`, `Estrutura:`, ...a.structure.map((b) => `- ${b.beat} (${fmtTime(b.fromSec)}–${fmtTime(b.toSec)}): ${b.purpose}`), `CTA: ${a.cta}`, `Tom: ${a.tone}`, `Ritmo: ${a.pacing}`, `Por que funciona: ${a.whyItWorks}`].join("\n");
}

// ─────────────────────────── nota de viralidade ───────────────────────────

export interface ViralityReview {
  score: number;
  hook: { score: number; note: string };
  pacing: { score: number; note: string };
  clarity: { score: number; note: string };
  cta: { score: number; note: string };
  improvements: string[];
  bestVersion?: string;
}

/** Avalia um roteiro (cenas) ou uma transcrição: gancho, ritmo, clareza da oferta e CTA, com sugestões. */
export async function reviewVirality(input: { kind: "script" | "transcript"; text: string; durationSec?: number; context?: string }): Promise<ViralityReview> {
  const system = `Você é diretor de performance de criativos da G2 Educação (anúncios e vídeos curtos sobre vender na Shopee, Brasil).
Dê uma NOTA DE VIRALIDADE de 0 a 10 ${input.kind === "script" ? "a este roteiro (cena a cena)" : "a este vídeo (transcrição)"} e explique: gancho (3 primeiros segundos), ritmo (uma ideia por cena, frases curtas), clareza da oferta/promessa e CTA.
Seja específico e prático: cite as frases, diga o que trocar. ${input.context ? `Contexto: ${input.context}` : ""}
Responda SÓ em JSON: {"score":<0-10>,"hook":{"score":<0-10>,"note":"…"},"pacing":{"score":<0-10>,"note":"…"},"clarity":{"score":<0-10>,"note":"…"},"cta":{"score":<0-10>,"note":"…"},"improvements":["<até 5 melhorias concretas>"],"bestVersion":"<reescreva o gancho (primeira frase) na melhor versão>"}`;
  const { json } = await chatJson<ViralityReview>(system, `${input.durationSec ? `Duração: ${fmtTime(input.durationSec)}\n` : ""}${input.text.slice(0, 40_000)}`, { temperature: 0.3, maxTokens: 1500 });
  return json;
}

// ─────────────────────────── exportar legendas ───────────────────────────

// ───────────────────────────── texto do post ─────────────────────────────

export interface PostCopy { title: string; caption: string; hashtags: string[]; hook: string; cta: string; youtubeDescription?: string }
const copySchema = z.object({ title: z.string(), caption: z.string(), hashtags: z.array(z.string()).max(30), hook: z.string(), cta: z.string(), youtubeDescription: z.string().optional() });

/** Seed 2.1 escreve legenda, título, hashtags e CTA do post a partir do que o vídeo diz (cota grátis de texto) */
export async function writeCopy(text: string, opt: { platform: "instagram" | "youtube" | "tiktok" | "ads"; context?: string; language?: string }): Promise<PostCopy> {
  const lang = opt.language && opt.language !== "pt-BR" ? `Escreva tudo em ${opt.language === "en" ? "inglês" : opt.language === "es" ? "espanhol" : opt.language}.` : "Escreva em português do Brasil.";
  const rules: Record<string, string> = {
    instagram: "Legenda de Reels: primeira linha é o gancho (até 90 caracteres, sem clickbait vazio), 3–6 linhas curtas com o valor do vídeo, CTA no fim (salvar/comentar/link na bio). 8–15 hashtags: nicho + amplas, sem repetir palavra do texto.",
    tiktok: "Legenda curta de TikTok (até 150 caracteres) com gancho e 3–5 hashtags.",
    youtube: "Título de Short (até 60 caracteres, curioso, sem caixa alta gritada) + descrição do YouTube de 3–5 linhas com palavras-chave + 5–10 hashtags.",
    ads: "Texto primário de anúncio Meta (até 125 caracteres no primeiro parágrafo, depois 2–3 linhas), título de 40 caracteres e CTA. Sem hashtags.",
  };
  const system = `Você é copywriter da G2 Educação (e-commerce, Shopee, vendas, marketing para quem vende online). ${rules[opt.platform]} Tom direto, humano, sem emoji em excesso (máx. 3), sem promessas de ganho garantido. ${lang}
${opt.context ? `Contexto: ${opt.context}` : ""}
Responda SÓ em JSON: {"title":"<título curto>","hook":"<primeira linha>","caption":"<legenda completa, com quebras de linha \\n>","cta":"<chamada final>","hashtags":["#tag",...],"youtubeDescription":"<só se for youtube>"}`;
  const { json } = await chatJson<unknown>(system, `O vídeo diz:\n${text.slice(0, 6000)}`, { temperature: 0.6, maxTokens: 1200 });
  return copySchema.parse(json);
}

const srtTime = (ms: number, sep = ",") => {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  const mil = Math.floor(ms % 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}${sep}${String(mil).padStart(3, "0")}`;
};

/** SRT / VTT / TXT a partir da transcrição (frases curtas, estilo legenda de Reels; ou segmentos inteiros) */
export function exportTranscript(t: Transcript, format: "srt" | "vtt" | "txt", opt: { short?: boolean } = {}): string {
  if (format === "txt") return t.segments.map((s) => `[${fmtTime(s.start)}] ${s.text}`).join("\n");
  const cues = opt.short === false
    ? t.segments.map((s) => ({ start: s.start * 1000, end: s.end * 1000, text: s.text }))
    : chunkWords(t.segments.flatMap((s) => s.words)).map((c) => ({ start: c.start_time, end: c.end_time, text: c.text }));
  const sep = format === "vtt" ? "." : ",";
  const body = cues.map((c, i) => `${format === "srt" ? `${i + 1}\n` : ""}${srtTime(c.start, sep)} --> ${srtTime(Math.max(c.end, c.start + 300), sep)}\n${c.text}\n`).join("\n");
  return format === "vtt" ? `WEBVTT\n\n${body}` : body;
}
