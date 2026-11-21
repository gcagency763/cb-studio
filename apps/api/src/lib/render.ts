import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "./env.js";
import { diskPath, ensureLocal, keyOf, putObject } from "./storage.js";

/**
 * Render final: cenas (mp4) → normaliza 9:16 → legenda queimada → concat → MP4.
 * Áudio: usa `audioUrl` da cena se houver (narração), senão silêncio — assim o
 * vídeo final já sai com faixa de áudio e a narração entra depois sem mudar nada.
 */

export interface RenderWord { start_time: number; end_time: number; text: string }
export interface RenderSentence { start_time: number; end_time: number; text: string; words?: RenderWord[] }

export interface RenderCard {
  /** texto grande do card (ex.: "ESFRIOU") */
  text: string;
  /** linha menor, opcional */
  subtext?: string;
  /** texto do botão (card final / CTA) */
  button?: string;
  /** imagem de fundo (zoom lento). Sem ela: fundo sólido */
  bgUrl?: string;
  bgColor?: string;
}

/** quanto um clipe pode ser desacelerado pra cobrir a narração antes de congelar o último frame (12% não se percebe; mais que isso fica "lento") */
const MAX_STRETCH = 1.12;

export interface RenderScene {
  /** caminho local "/storage/videos/x.mp4" ou URL http. Opcional quando é card. */
  videoUrl?: string;
  /** planos extras da mesma fala (cenas mudas seguintes): entram em sequência depois do vídeo principal */
  extraVideoUrls?: string[];
  /** corta o silêncio do começo e do fim da narração pelos tempos das palavras (default true) */
  trimSilence?: boolean;
  /** narração contínua (options.narrationUrl): trecho dela que toca nesta cena, em segundos; a cena dura isso + tailSec */
  audioSpan?: { start: number; end: number };
  /** card de texto no lugar de vídeo */
  card?: RenderCard;
  /** texto da legenda (narração da cena) */
  caption?: string;
  /** narração (mp3/wav). Se existir, a cena dura o tempo da fala. */
  audioUrl?: string;
  /** frases com timestamps (ms) — vindas do Seed Audio; legenda sincronizada */
  sentences?: RenderSentence[];
  /** esconde a legenda nesta cena (ex.: card já mostra o texto) */
  hideCaption?: boolean;
  /** duração alvo; default = duração do clipe (ou da narração) */
  durationSec?: number;
  /** respiro após a fala, em segundos */
  tailSec?: number;
}

export interface RenderOptions {
  width?: number;
  height?: number;
  fps?: number;
  /** tamanho da fonte da legenda em px (base 1080 de largura) */
  fontSize?: number;
  fontName?: string;
  /** margem inferior da legenda em px */
  marginBottom?: number;
  /** cor de fundo das barras (letterbox) */
  padColor?: string;
  /** "karaoke" = palavra atual destacada (precisa de words); "sentence" = frase inteira */
  captionStyle?: "karaoke" | "sentence";
  /** karaokê: frase mais longa que isso é mostrada em blocos (quebra na pontuação; ~2 linhas). 0 = frase inteira */
  captionMaxChars?: number;
  /** cor da palavra destacada (hex RGB, ex. "#F5C04A") */
  highlightColor?: string;
  uppercase?: boolean;
  /** música de fundo (mp3) com ducking sob a narração */
  musicUrl?: string;
  /** 0..1 — volume da música (default 0.18) */
  musicVolume?: number;
  /** narração contínua do projeto (uma tomada): as cenas com audioSpan tocam trechos dela, sem emenda de áudio */
  narrationUrl?: string;
  /** pula o começo de cada clipe de IA (o primeiro instante costuma ficar parado no quadro inicial) */
  clipHeadSec?: number;
}

export const defaults: Required<RenderOptions> = {
  width: 1080,
  height: 1920,
  fps: 24,
  fontSize: 58,
  fontName: "Arial",
  marginBottom: 260,
  padColor: "black",
  captionStyle: "karaoke",
  captionMaxChars: 46,
  highlightColor: "#F5C04A",
  uppercase: false,
  musicUrl: "",
  musicVolume: 0.18,
  narrationUrl: "",
  clipHeadSec: 0,
};

/** "#RRGGBB" → cor ASS "&H00BBGGRR" */
export function assColor(hex: string, alpha = "00") {
  const h = hex.replace("#", "").padEnd(6, "0");
  return `&H${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

// ─────────────────────────── ffmpeg binário ───────────────────────────

export function ffmpegBin(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const require = createRequire(import.meta.url);
    const p = require("ffmpeg-static") as string | null;
    // o binário só existe se o script de instalação rodou (pnpm.onlyBuiltDependencies)
    if (p && existsSync(p)) return p;
  } catch {
    /* sem ffmpeg-static → usa o do sistema */
  }
  return "ffmpeg";
}

export function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out || err) : reject(new Error(`${bin} saiu com ${code}\n${err.slice(-2000)}`))));
  });
}

export async function probeDuration(bin: string, file: string): Promise<number> {
  // ffprobe pode não existir junto do ffmpeg-static; `ffmpeg -i` sem saída
  // falha de propósito, mas imprime "Duration: hh:mm:ss.cc" no stderr.
  const text = await run(bin, ["-hide_banner", "-i", file]).catch((e: Error) => e.message);
  const m = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(text);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 5;
}

// ─────────────────────────── legenda (ASS) ───────────────────────────

export function assTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${sec}`;
}

export function escapeAss(t: string) {
  return t.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\r?\n/g, "\\N");
}

/** quebra em linhas de até ~N caracteres (libass também quebra, mas assim fica previsível) */
export function wrap(text: string, max = 28): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}

export function assHeader(o: Required<RenderOptions>, extraStyles = "") {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${o.width}
PlayResY: ${o.height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${o.fontName},${o.fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,2,80,80,${o.marginBottom},1
${extraStyles}
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

const tx = (t: string, o: Required<RenderOptions>) => (o.uppercase ? t.toUpperCase() : t);

/** legenda: frase inteira por vez, ou karaokê (palavra atual destacada) */
export function buildAss(caption: string, dur: number, o: Required<RenderOptions>, sentences?: RenderSentence[]): string {
  const lines: string[] = [];
  const hl = assColor(o.highlightColor);
  if (sentences && sentences.length) {
    for (let si = 0; si < sentences.length; si++) {
      const sen = sentences[si];
      const text = sen.text.trim();
      if (!text) continue;
      // respiro de 0,15 s depois da frase, mas nunca por cima da próxima (senão duas legendas empilham)
      const nextStart = sentences[si + 1] ? sentences[si + 1].start_time / 1000 - 0.02 : Infinity;
      const end = Math.max(sen.start_time / 1000 + 0.05, Math.min(dur, sen.end_time / 1000 + 0.15, nextStart));
      const words = spokenWords(sen.words);
      if (o.captionStyle === "karaoke" && words.length > 1) {
        // uma Dialogue por palavra: o bloco da frase (a frase inteira, se for curta), com a palavra atual colorida
        const blocks = captionBlocks(words, text, o.captionMaxChars);
        for (let b = 0; b < blocks.length; b++) {
          const block = blocks[b];
          const blockEnd = blocks[b + 1] ? blocks[b + 1][0].start_time / 1000 : end;
          for (let i = 0; i < block.length; i++) {
            const ws = block[i].start_time / 1000;
            const we = i + 1 < block.length ? block[i + 1].start_time / 1000 : blockEnd;
            if (we <= ws) continue;
            const body = block
              .map((w, k) => {
                const t = escapeAss(tx(cleanWord(w.text), o));
                return k === i ? `{\\c${hl}}${t}{\\c&HFFFFFF&}` : t;
              })
              .join(" ");
            lines.push(`Dialogue: 0,${assTime(ws)},${assTime(we)},Cap,,0,0,0,,${wrapAss(body)}`);
          }
        }
      } else {
        lines.push(`Dialogue: 0,${assTime(sen.start_time / 1000)},${assTime(end)},Cap,,0,0,0,,${escapeAss(wrap(tx(text, o)))}`);
      }
    }
  } else if (caption.trim()) {
    lines.push(`Dialogue: 0,${assTime(0)},${assTime(dur)},Cap,,0,0,0,,${escapeAss(wrap(tx(caption.trim(), o)))}`);
  }
  return assHeader(o) + lines.join("\n") + "\n";
}

/**
 * Palavras faladas de uma frase. O Seed Audio manda espaço e pontuação como tokens à parte (":", ",", "?"):
 * a pontuação gruda na palavra anterior — é ela que diz onde a legenda quebra, e "?"/"!" aparecem na tela.
 */
export function spokenWords<T extends { text: string }>(tokens: T[] | undefined): T[] {
  const out: T[] = [];
  for (const w of tokens ?? []) {
    const t = w.text.trim();
    if (!t) continue;
    if (/[\p{L}\p{N}]/u.test(t)) out.push({ ...w, text: t });
    else if (out.length) out[out.length - 1] = { ...out[out.length - 1], text: out[out.length - 1].text + t };
  }
  return out;
}

/** tira pontuação solta das pontas da palavra ("nove..." → "nove"); "?" e "!" ficam */
export function cleanWord(t: string): string {
  const c = t.trim().replace(/^["“”'‘’«»([{.,;:…]+/u, "").replace(/["“”'‘’«»)\]}.,;:…]+$/u, "");
  return c || t.trim();
}

// palavras que não devem fechar um bloco de legenda ("… A PARTIR DE" / "CINQUENTA MIL …")
const WEAK_END = new Set("a o as os um uma uns umas e ou mas nem que se de do da dos das em no na nos nas ao aos à às por pra pro para com sem sob the an of to in on and or el la los las y en con".split(" "));
// palavras de número: não quebra no meio de "cinquenta e cinco milhões"
const NUM_WORD = /^(\d[\d.,]*|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzent[oa]s|trezent[oa]s|quatrocent[oa]s|quinhent[oa]s|seiscent[oa]s|setecent[oa]s|oitocent[oa]s|novecent[oa]s|mil|milh[aã]o|milh[oõ]es|bilh[aã]o|bilh[oõ]es)$/i;
// depois de "milhões"/"mil" a fala respira: é onde um número comprido pode quebrar
const MAGNITUDE = /^(mil|milh[aã]o|milh[oõ]es|bilh[aã]o|bilh[oõ]es)$/i;
// o que o número conta fica com ele ("oitocentos mil | reais" não)
const UNIT = /^(reais|real|d[oó]lar(es)?|euros?|centavos?|quilos?|kg|gramas?|toneladas?|litros?|metros?|km|anos?|m[eê]s(es)?|semanas?|dias?|horas?|minutos?|segundos?|vezes|por|%|pessoas?|notas?|bolsas?|clientes?|vendas?|pedidos?)$/i;

/**
 * Pontuação depois de cada palavra, lida no texto da frase (os tokens do TTS vêm sem vírgula):
 * 0 = nada, 1 = vírgula (pausa leve), 2 = dois-pontos, reticências, ponto, "?", "!", travessão (pausa forte).
 */
function punctAfter(words: { text: string }[], text: string): number[] {
  const src = text.toLowerCase();
  const strength = (p: string) => (/[:;…!?—–]|\.\s*\.|\.\s|\.$|\s-\s/u.test(p) ? 2 : /,/.test(p) ? 1 : 0);
  let pos = 0;
  return words.map((w) => {
    const raw = w.text.trim();
    const own = strength(/[^\p{L}\p{N}]*$/u.exec(raw)?.[0] ?? "");
    const core = cleanWord(raw).toLowerCase();
    if (!core) return own;
    // procura a palavra logo à frente (janela curta: se o TTS normalizou o texto, não sai alinhando errado)
    let at = -1;
    for (let from = pos; from <= pos + 24; ) {
      const k = src.indexOf(core, from);
      if (k < 0 || k > pos + 24) break;
      const before = k === 0 ? " " : src[k - 1];
      const after = src[k + core.length] ?? " ";
      if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) {
        at = k;
        break;
      }
      from = k + 1;
    }
    if (at < 0) return own;
    pos = at + core.length;
    const gap = /^[^\p{L}\p{N}]*/u.exec(src.slice(pos))?.[0] ?? "";
    return Math.max(own, strength(gap));
  });
}

/**
 * Karaokê em blocos: frase longa não vira parede de texto, e o que vem depois de dois-pontos entra sozinho.
 * Pausa forte (":", "…", "?", ponto) sempre separa; vírgula separa quando o trecho passa de `max`; o que ainda
 * sobrar comprido é dividido em partes equilibradas — sem fechar bloco em preposição nem partir número.
 * Cada bloco fica na tela enquanto as palavras dele são faladas.
 */
export function captionBlocks<T extends { text: string }>(words: T[], text: string, max: number): T[][] {
  if (!max || max < 12 || words.length < 2) return [words];
  const clean = (w: T) => cleanWord(w.text);
  const len = (ws: T[]) => ws.reduce((a, w) => a + clean(w).length, 0) + Math.max(0, ws.length - 1);
  const punct = punctAfter(words, text);
  const cutAt = (ws: T[], marks: number[], min: number) => {
    const out: { ws: T[]; marks: number[] }[] = [];
    let from = 0;
    marks.forEach((m, i) => {
      if (m >= min && i < ws.length - 1) {
        out.push({ ws: ws.slice(from, i + 1), marks: marks.slice(from, i + 1) });
        from = i + 1;
      }
    });
    out.push({ ws: ws.slice(from), marks: marks.slice(from) });
    return out;
  };
  const isNum = (w?: T) => !!w && NUM_WORD.test(clean(w));
  const low = (w?: T) => (w ? clean(w).toLowerCase() : "");
  const split = (ws: T[]): T[][] => {
    const total = len(ws);
    if (total <= max || ws.length < 2) return [ws];
    const target = total / Math.ceil(total / max);
    let best = -1;
    let bestCost = Infinity;
    let acc = 0;
    for (let i = 0; i < ws.length - 1; i++) {
      acc += clean(ws[i]).length + (i ? 1 : 0);
      if (acc > max + 6 && best >= 0) break;
      let cost = Math.abs(acc - target);
      if (WEAK_END.has(low(ws[i]))) cost += 9;
      // dentro de número ("cinquenta | e cinco"): só depois de "milhões"/"mil" a quebra é barata
      const numAhead = isNum(ws[i + 1]) || (low(ws[i + 1]) === "e" && isNum(ws[i + 2]));
      if (isNum(ws[i]) && numAhead) cost += MAGNITUDE.test(clean(ws[i])) && low(ws[i + 1]) === "e" ? 4 : 12;
      if (low(ws[i]) === "e" && isNum(ws[i - 1]) && isNum(ws[i + 1])) cost += 12;
      if (isNum(ws[i]) && UNIT.test(clean(ws[i + 1]))) cost += 8;
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    if (best < 0) return [ws];
    return [ws.slice(0, best + 1), ...split(ws.slice(best + 1))];
  };
  const out: T[][] = [];
  for (const seg of cutAt(words, punct, 2)) {
    // dentro de um trecho: vírgulas e divisão equilibrada só se ele não couber; pedaços vizinhos curtinhos voltam a ficar juntos
    const pieces = len(seg.ws) <= max ? [seg.ws] : cutAt(seg.ws, seg.marks, 1).flatMap((c) => split(c.ws));
    const merged: T[][] = [];
    for (const p of pieces) {
      const last = merged[merged.length - 1];
      if (last && len(last) + 1 + len(p) <= Math.min(max, 30)) last.push(...p);
      else merged.push([...p]);
    }
    out.push(...merged);
  }
  return out;
}

/**
 * Quebra de linha para texto que já contém tags ASS (conta só os caracteres visíveis).
 * Linhas equilibradas: "SÓ QUE ESSE / PADRÃO TEM NOME" em vez de deixar uma palavra sozinha embaixo.
 */
function wrapAss(body: string, max = 26): string {
  const tokens = body.split(" ");
  const vis = tokens.map((t) => t.replace(/\{[^}]*\}/g, "").length);
  const fill = (limit: number) => {
    const lines: number[][] = [[]];
    let len = 0;
    tokens.forEach((_, i) => {
      const add = (len ? 1 : 0) + vis[i];
      if (len && len + add > limit) {
        lines.push([i]);
        len = vis[i];
      } else {
        lines[lines.length - 1].push(i);
        len += add;
      }
    });
    return lines;
  };
  let lines = fill(max - 1);
  if (lines.length > 1) {
    // a menor largura que ainda cabe no mesmo número de linhas
    const total = vis.reduce((a, b) => a + b, 0) + tokens.length - 1;
    for (let limit = Math.ceil(total / lines.length); limit < max - 1; limit++) {
      const t = fill(limit);
      if (t.length <= lines.length) {
        lines = t;
        break;
      }
    }
  }
  return lines.map((idx) => idx.map((i) => tokens[i]).join(" ")).join("\\N");
}

/** card de texto: título grande centralizado, subtítulo e botão (caixa) */
function buildCardAss(card: RenderCard, dur: number, o: Required<RenderOptions>): string {
  const gold = assColor(o.highlightColor);
  const big = Math.round(o.fontSize * 2.4);
  const sub = Math.round(o.fontSize * 0.9);
  const btn = Math.round(o.fontSize * 0.95);
  const styles = `Style: Title,${o.fontName},${big},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,2,0,1,5,3,5,60,60,0,1
Style: Sub,${o.fontName},${sub},&H00E6E6E6,&H00FFFFFF,&H00000000,&H00000000,0,-1,0,0,100,100,0,0,1,2,1,5,80,80,0,1
Style: Btn,${o.fontName},${btn},&H00141414,&H00FFFFFF,${gold},${gold},-1,0,0,0,100,100,3,0,3,18,0,5,0,0,0,1
`;
  const lines: string[] = [];
  const fade = "{\\fad(250,250)}";
  // layout vertical: mede os blocos (título pode ter 1–3 linhas) e empilha centrado,
  // pra título longo nunca invadir o subtítulo/botão
  const titleTxt = wrap(card.text, 14);
  const subTxt = card.subtext ? wrap(card.subtext, 30) : "";
  const titleH = titleTxt.split("\n").length * big * 1.15;
  const subH = subTxt ? subTxt.split("\n").length * sub * 1.3 : 0;
  const btnH = card.button ? btn * 1.9 : 0;
  const gap = Math.round(o.fontSize * 0.9);
  const totalH = titleH + (subH ? gap + subH : 0) + (btnH ? gap * 1.6 + btnH : 0);
  let y = o.height * 0.5 - totalH / 2;
  const titleY = Math.round(y + titleH / 2);
  y += titleH + gap;
  lines.push(`Dialogue: 0,${assTime(0)},${assTime(dur)},Title,,0,0,0,,${fade}{\\pos(${o.width / 2},${titleY})\\fscx96\\fscy96\\t(0,300,\\fscx100\\fscy100)}${escapeAss(titleTxt)}`);
  if (subTxt) {
    lines.push(`Dialogue: 0,${assTime(0.15)},${assTime(dur)},Sub,,0,0,0,,${fade}{\\pos(${o.width / 2},${Math.round(y + subH / 2)})}${escapeAss(subTxt)}`);
    y += subH;
  }
  if (card.button) lines.push(`Dialogue: 0,${assTime(0.3)},${assTime(dur)},Btn,,0,0,0,,${fade}{\\pos(${o.width / 2},${Math.round(y + gap * 1.6 + btnH / 2)})}  ${escapeAss(card.button.toUpperCase())}  `);
  return assHeader(o, styles) + lines.join("\n") + "\n";
}


// ─────────────────────────── pipeline ───────────────────────────

export function localPath(ref: string): string {
  return diskPath(keyOf(ref));
}

/** caminho no disco, baixando do bucket antes se o arquivo só estiver lá (nuvem) */
export async function localFile(ref: string): Promise<string> {
  const key = keyOf(ref);
  if (!(await ensureLocal(key))) throw new Error(`arquivo não encontrado: ${ref}`);
  return diskPath(key);
}

export async function materialize(ref: string, dest: string): Promise<string> {
  // caminho absoluto de arquivo local (ex.: b-roll temporário) → usa direto
  if (ref.startsWith("/") && !ref.startsWith("/storage/") && existsSync(ref)) return ref;
  if (/^https?:/.test(ref)) {
    const res = await fetch(ref);
    if (!res.ok) throw new Error(`download ${res.status} ${ref}`);
    await writeFile(dest, new Uint8Array(await res.arrayBuffer()));
    return dest;
  }
  return localFile(ref);
}

export async function renderProject(
  scenes: RenderScene[],
  opts: RenderOptions,
  outKey: string,
  onProgress?: (p: { step: string; scene?: number; total?: number }) => void,
): Promise<{ key: string; url: string; durationSec: number }> {
  if (!scenes.length) throw new Error("nenhuma cena para renderizar");
  const o = { ...defaults, ...opts };
  const bin = ffmpegBin();
  const work = join(tmpdir(), `g2render-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await mkdir(work, { recursive: true });

  try {
    const parts: string[] = [];
    const partDurs: number[] = [];
    let total = 0;

    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      onProgress?.({ step: "cena", scene: i + 1, total: scenes.length });

      let audio: string | null = null;
      let audioDur = 0;
      let audioSS = 0;
      let audioCut = false;
      let sentences = sc.sentences;
      // narração contínua: a parte sai muda e com a duração exata (em quadros) do trecho; o áudio entra no final
      const spanDur = sc.audioSpan && o.narrationUrl ? Math.round((sc.audioSpan.end - sc.audioSpan.start + (sc.tailSec ?? 0)) * o.fps) / o.fps : null;
      if (sc.audioUrl && spanDur == null) {
        audio = await materialize(sc.audioUrl, join(work, `aud${i}`));
        audioDur = await probeDuration(bin, audio);
        // o Seed Audio deixa ~0,4 s de silêncio antes e ~1 s depois da fala: corta pelos tempos das palavras
        // (a legenda anda junto) — sem isso cada troca de cena vira uma pausa de mais de 1 s
        const marks = (sc.sentences ?? []).flatMap((x) => (x.words?.length ? x.words : [x]));
        if (marks.length && sc.trimSilence !== false) {
          const a = Math.max(0, Math.min(...marks.map((w) => w.start_time)) / 1000 - 0.06);
          const b = Math.min(audioDur, Math.max(...marks.map((w) => w.end_time)) / 1000 + 0.18);
          if (b - a > 0.3 && (a > 0.02 || audioDur - b > 0.05)) {
            audioSS = a;
            audioDur = b - a;
            audioCut = true;
            const sh = a * 1000;
            sentences = sc.sentences!.map((x) => ({ ...x, start_time: x.start_time - sh, end_time: x.end_time - sh, words: x.words?.map((w) => ({ ...w, start_time: w.start_time - sh, end_time: w.end_time - sh })) }));
          }
        }
      }
      const out = join(work, `part${i}.mp4`);
      const args = ["-hide_banner", "-y"];
      const vf: string[] = [];
      let dur: number;
      /** cenas de vídeo usam filter_complex (um ou mais planos); cards usam -vf */
      let filterComplex: string | null = null;
      let videoInputs = 1;

      if (sc.card) {
        // ── card de texto ──
        dur = spanDur ?? sc.durationSec ?? (audio ? audioDur + (sc.tailSec ?? 0.4) : 2.2);
        if (sc.card.bgUrl) {
          const bg = await materialize(sc.card.bgUrl, join(work, `bg${i}`));
          args.push("-loop", "1", "-framerate", String(o.fps), "-i", bg);
          const frames = Math.ceil(dur * o.fps);
          vf.push(
            `scale=${o.width * 1.15}:${o.height * 1.15}:force_original_aspect_ratio=increase`,
            `crop=${o.width * 1.15}:${o.height * 1.15}`,
            `zoompan=z='1+0.0006*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${o.width}x${o.height}:fps=${o.fps}`,
            `eq=brightness=-0.12:contrast=1.05`,
          );
        } else {
          args.push("-f", "lavfi", "-i", `color=c=${(sc.card.bgColor ?? "#1a1714").replace("#", "0x")}:s=${o.width}x${o.height}:r=${o.fps}`);
        }
        vf.push(`fps=${o.fps}`, `setsar=1`);
        const ass = join(work, `card${i}.ass`);
        await writeFile(ass, buildCardAss(sc.card, dur, o));
        vf.push(`subtitles='${ass.replace(/\\/g, "/").replace(/:/g, "\\:")}'`);
      } else {
        // ── cena de vídeo: um plano ou vários (a fala continua nos planos extras) ──
        const urls = [sc.videoUrl, ...(sc.extraVideoUrls ?? [])].filter((u): u is string => !!u);
        if (!urls.length) throw new Error(`cena ${i + 1} sem vídeo nem card`);
        const clips: { src: string; d: number; head: number }[] = [];
        for (let k = 0; k < urls.length; k++) {
          const src = await materialize(urls[k], join(work, `src${i}_${k}.mp4`));
          const full = await probeDuration(bin, src);
          // plano parado (imagem com zoom) não tem "instante parado" no começo
          const head = /\/stills?\//.test(urls[k]) ? 0 : Math.min(o.clipHeadSec, full * 0.15);
          clips.push({ src, d: full - head, head });
        }
        const sum = clips.reduce((acc, c) => acc + c.d, 0);
        // com narração, a cena dura a fala + respiro; sem, dura os clipes
        dur = spanDur ?? sc.durationSec ?? (audio ? audioDur + (sc.tailSec ?? 0.4) : sum);
        // clipes mais longos que a fala → corta o fim de cada plano na mesma proporção (todos aparecem);
        // mais curtos → desacelera no máximo 12% (com quadros misturados) e só o que ainda sobrar congela
        const cut = dur < sum - 0.02 ? dur / sum : 1;
        const stretch = dur > sum + 0.05 ? Math.min(MAX_STRETCH, dur / sum) : 1;
        const applied = stretch > 1.02 ? stretch : 1;
        const fc: string[] = [];
        clips.forEach((c, k) => {
          args.push("-i", c.src);
          const chain: string[] = [];
          if (cut < 1 || c.head > 0) chain.push(`trim=${c.head.toFixed(3)}:${(c.head + c.d * cut).toFixed(3)}`, `setpts=PTS-STARTPTS`);
          if (applied > 1) chain.push(`setpts=${applied.toFixed(4)}*PTS`, `framerate=fps=${o.fps}:interp_start=0:interp_end=255:scene=100`);
          chain.push(
            `scale=${o.width}:${o.height}:force_original_aspect_ratio=decrease`,
            `pad=${o.width}:${o.height}:(ow-iw)/2:(oh-ih)/2:color=${o.padColor}`,
            `fps=${o.fps}`,
            `setsar=1`,
          );
          fc.push(`[${k}:v]${chain.join(",")}[c${k}]`);
        });
        let cur = "c0";
        if (clips.length > 1) {
          fc.push(`${clips.map((_, k) => `[c${k}]`).join("")}concat=n=${clips.length}:v=1:a=0[cat]`);
          cur = "cat";
        }
        const post: string[] = [];
        const covered = sum * applied;
        if (dur > covered + 0.05) post.push(`tpad=stop_mode=clone:stop_duration=${(dur - covered).toFixed(2)}`);
        if (!sc.hideCaption && (sc.caption?.trim() || sentences?.length)) {
          const ass = join(work, `cap${i}.ass`);
          await writeFile(ass, buildAss((sc.caption ?? "").trim(), dur, o, sentences));
          post.push(`subtitles='${ass.replace(/\\/g, "/").replace(/:/g, "\\:")}'`);
        }
        fc.push(`[${cur}]${post.length ? post.join(",") : "null"}[vout]`);
        filterComplex = fc.join(";");
        videoInputs = clips.length;
      }
      total += dur;
      partDurs.push(dur);
      if (audio) {
        // áudio mais curto que a cena → completa com silêncio
        if (audioCut) args.push("-ss", audioSS.toFixed(3), "-t", audioDur.toFixed(3));
        args.push("-i", audio, "-af", `apad=whole_dur=${dur.toFixed(2)}`);
      } else {
        args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
      }
      if (filterComplex) args.push("-filter_complex", filterComplex, "-map", "[vout]", "-map", `${videoInputs}:a:0`);
      else args.push("-map", "0:v:0", "-map", "1:a:0", "-vf", vf.join(","));
      args.push(
        "-t", String(dur),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
        "-shortest",
        "-movflags", "+faststart",
        out,
      );
      await run(bin, args);
      parts.push(out);
    }

    onProgress?.({ step: "concat" });
    const list = join(work, "list.txt");
    await writeFile(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
    const finalTmp = join(work, "final.mp4");
    if (o.narrationUrl && scenes.some((x) => x.audioSpan)) {
      // narração contínua: o áudio inteiro sai da tomada, recortado nos trechos de cada cena (cortes no silêncio,
      // em PCM — sem a microfalha de emendar AAC) e completado com silêncio onde a cena não tem fala
      const narr = await materialize(o.narrationUrl, join(work, "narration"));
      const graph: string[] = [];
      const labels: string[] = [];
      partDurs.forEach((d, k) => {
        const sp = scenes[k].audioSpan;
        if (sp) graph.push(`[1:a]atrim=${sp.start.toFixed(3)}:${Math.min(sp.end, sp.start + d).toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur=${d.toFixed(3)}[n${k}]`);
        else graph.push(`aevalsrc=0:c=stereo:s=48000:d=${d.toFixed(3)}[n${k}]`);
        labels.push(`[n${k}]`);
      });
      graph.push(`${labels.join("")}concat=n=${labels.length}:v=0:a=1,loudnorm=I=-16:TP=-1.5:LRA=11[voice]`);
      const inputs = ["-f", "concat", "-safe", "0", "-i", list, "-i", narr];
      if (o.musicUrl) {
        const music = await materialize(o.musicUrl, join(work, "music"));
        inputs.push("-stream_loop", "-1", "-i", music);
        const vol = Math.min(1, Math.max(0, o.musicVolume));
        const fadeStart = Math.max(0, total - 2.5).toFixed(2);
        graph.push(`[voice]asplit[v1][v2]`, `[2:a]volume=${vol},aformat=sample_rates=48000:channel_layouts=stereo[m]`, `[m][v1]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=400[md]`, `[v2][md]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,afade=t=out:st=${fadeStart}:d=2.5[a]`);
      } else graph.push(`[voice]anull[a]`);
      await run(bin, ["-hide_banner", "-y", ...inputs, "-filter_complex", graph.join(";"), "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", finalTmp]);
    } else if (o.musicUrl) {
      // música em loop, volume baixo, abaixa (ducking) quando há narração, fade no fim
      const music = await materialize(o.musicUrl, join(work, "music"));
      const vol = Math.min(1, Math.max(0, o.musicVolume));
      const fadeStart = Math.max(0, total - 2.5).toFixed(2);
      await run(bin, [
        "-hide_banner", "-y",
        "-f", "concat", "-safe", "0", "-i", list,
        "-stream_loop", "-1", "-i", music,
        "-filter_complex",
        `[1:a]volume=${vol},aformat=sample_rates=48000:channel_layouts=stereo[m];` +
          `[m][0:a]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=400[md];` +
          `[0:a][md]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,afade=t=out:st=${fadeStart}:d=2.5[a]`,
        "-map", "0:v:0", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart", finalTmp,
      ]);
    } else {
      await run(bin, ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", finalTmp]);
    }

    const stored = await putObject(outKey, await readFile(finalTmp), "video/mp4");
    return { key: stored.key, url: stored.url, durationSec: +total.toFixed(2) };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
