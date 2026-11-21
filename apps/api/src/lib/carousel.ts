import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { getJob } from "./db.js";
import type { BrandLogo } from "./edit.js";
import { enqueue, guard, plan } from "./generate.js";
import { chatJson } from "./llm.js";
import { assColor, escapeAss, ffmpegBin, materialize, run, wrap } from "./render.js";
import { STYLES } from "./script.js";
import { putObject } from "./storage.js";

/**
 * Carrossel pro Instagram (1080×1350 ou 1080×1080): Seed 2.1 escreve os slides (capa com gancho,
 * conteúdo, CTA) + legenda do post; Seedream gera a arte de cada slide (cota grátis); FFmpeg
 * compõe texto (ASS) por cima com um degradê — e o zip sai pronto pra postar.
 */
export interface CarouselSlide { kind: "cover" | "content" | "cta"; headline: string; body?: string; prompt: string }
export interface CarouselPlan { title: string; slides: CarouselSlide[]; caption: string; hashtags: string[] }
export interface CarouselOptions { theme: string; slides?: number; style?: string; audience?: string; tone?: string; context?: string; format?: "4:5" | "1:1"; logo?: BrandLogo | false; brandName?: string; accent?: string }

const planSchema = z.object({
  title: z.string(),
  slides: z.array(z.object({ kind: z.enum(["cover", "content", "cta"]), headline: z.string().min(1), body: z.string().optional(), prompt: z.string().min(5) })).min(3).max(12),
  caption: z.string(),
  hashtags: z.array(z.string()).max(30),
});

export async function writeCarousel(opt: CarouselOptions): Promise<CarouselPlan> {
  const n = Math.min(10, Math.max(3, opt.slides ?? 7));
  const style = STYLES[opt.style ?? "flat"] ?? STYLES.flat;
  const system = `Você é estrategista de conteúdo da G2 Educação (e-commerce, Shopee, vendas, marketing para quem vende online). Escreva um carrossel de Instagram com exatamente ${n} slides sobre o tema abaixo.
Regras:
- slide 1 = "cover": gancho forte em até 8 palavras (headline) + body opcional de até 12 palavras que provoca o "arrasta pro lado".
- slides do meio = "content": um ponto por slide; headline de até 7 palavras; body de até 28 palavras, concreto (número, exemplo, passo). Sem enrolação.
- último = "cta": headline curta (salvar/compartilhar/comentar/link na bio) + body de até 15 palavras.
- "prompt": descrição em inglês da ARTE DO FUNDO desse slide no estilo "${style.imageStyle}" — cena/objeto/metáfora ligada ao ponto, composição com área mais vazia na metade de baixo (o texto vai lá), SEM texto, SEM letras, SEM logos, sem rostos de pessoas reais.
- "caption": legenda do post (gancho na 1ª linha, 3–6 linhas, CTA). "hashtags": 10–15.
${opt.audience ? `Público: ${opt.audience}.` : ""} ${opt.tone ? `Tom: ${opt.tone}.` : ""} ${opt.context ? `Contexto: ${opt.context}.` : ""}
Responda SÓ em JSON: {"title":"...","slides":[{"kind":"cover|content|cta","headline":"...","body":"...","prompt":"..."}],"caption":"...","hashtags":["#..."]}`;
  const { json } = await chatJson<unknown>(system, `Tema: ${opt.theme}`, { temperature: 0.7, maxTokens: 3000 });
  const p = planSchema.parse(json);
  p.slides = p.slides.slice(0, n);
  p.slides[0].kind = "cover";
  if (p.slides.length >= 3 && !p.slides.some((x) => x.kind === "cta")) p.slides[p.slides.length - 1].kind = "cta";
  return p;
}

/** gera as artes (Seedream, cota grátis) em paralelo e espera */
async function generateArt(slides: CarouselSlide[], size: string, onProgress?: (s: string) => void): Promise<(string | null)[]> {
  const submit = async (s: CarouselSlide) => {
    const request = { kind: "image" as const, prompt: s.prompt, size, seed: Math.floor(Math.random() * 2_000_000_000), carousel: true };
    const { provider, cost } = plan(request);
    await guard(request, provider, cost, false);
    return (await enqueue(request, provider.name, cost, {})).id;
  };
  const jobs: string[] = [];
  for (const s of slides) jobs.push(await submit(s));
  const out: (string | null)[] = jobs.map(() => null);
  const retried = new Set<number>();
  const pending = new Set(jobs.map((_, i) => i));
  const until = Date.now() + 8 * 60_000;
  while (pending.size && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000));
    onProgress?.(`arte ${jobs.length - pending.size}/${jobs.length}`);
    for (const i of [...pending]) {
      const row = await getJob(jobs[i]);
      if (row?.status === "succeeded" && row.output_url) {
        out[i] = row.output_url;
        pending.delete(i);
      } else if (row?.status === "failed") {
        // falha transitória (rede, cota momentânea): tenta mais uma vez
        if (!retried.has(i)) {
          retried.add(i);
          jobs[i] = await submit(slides[i]).catch(() => jobs[i]);
          if (jobs[i] === row.id) pending.delete(i);
        } else pending.delete(i);
      }
    }
  }
  return out;
}

function slideAss(W: number, H: number, s: CarouselSlide, index: number, total: number, accent: string, brandName?: string) {
  const headSize = s.kind === "cover" ? Math.round(W * 0.085) : Math.round(W * 0.066);
  const bodySize = Math.round(W * 0.036);
  const margin = Math.round(W * 0.08);
  const bottom = Math.round(H * 0.09);
  const acc = assColor(accent);
  const head = escapeAss(wrap(s.headline.toUpperCase(), s.kind === "cover" ? 16 : 20));
  const body = s.body ? escapeAss(wrap(s.body, 38)) : "";
  const headLines = head.split("\\N").length;
  const bodyLines = body ? body.split("\\N").length : 0;
  // corpo embaixo; headline logo acima dele
  const bodyMargin = bottom;
  const headMargin = bottom + (bodyLines ? Math.round(bodyLines * bodySize * 1.35) + Math.round(W * 0.03) : 0);
  const topInfo = `${index + 1}/${total}`;
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Head,Arial,${headSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,-1,0,1,0,0,1,${margin},${margin},${headMargin},1
Style: Body,Arial,${bodySize},&H00F2F2F2,&H00F2F2F2,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,1,${margin},${margin},${bodyMargin},1
Style: Meta,Arial,${Math.round(W * 0.028)},${acc},${acc},&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,0,0,7,${margin},${margin},${Math.round(H * 0.045)},1
Style: Brand,Arial,${Math.round(W * 0.028)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,0,0,9,${margin},${margin},${Math.round(H * 0.045)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:10.00,Head,,0,0,0,,${s.kind === "cover" ? `{\\c${acc}}` : ""}${head}
${body ? `Dialogue: 0,0:00:00.00,0:00:10.00,Body,,0,0,0,,${body}` : ""}
Dialogue: 0,0:00:00.00,0:00:10.00,Meta,,0,0,0,,${escapeAss(s.kind === "cta" ? "→ salva e compartilha" : index === 0 ? "arrasta →" : topInfo)}
${brandName ? `Dialogue: 0,0:00:00.00,0:00:10.00,Brand,,0,0,0,,${escapeAss(brandName)}` : ""}
`;
}

export async function renderCarousel(planIn: CarouselPlan, opt: CarouselOptions, keyPrefix: string, onProgress?: (s: string) => void) {
  const bin = ffmpegBin();
  const W = 1080;
  const H = opt.format === "1:1" ? 1080 : 1350;
  const work = join(tmpdir(), `g2car-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await mkdir(work, { recursive: true });
  try {
    onProgress?.("gerando as artes");
    const art = await generateArt(planIn.slides, opt.format === "1:1" ? "2048x2048" : "1728x2160", onProgress);
    // degradê escuro na metade de baixo (uma vez)
    const grad = join(work, "grad.png");
    await run(bin, ["-hide_banner", "-y", "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}`, "-vf", `format=rgba,geq=r=0:g=0:b=0:a='clip((Y-${Math.round(H * 0.42)})/${Math.round(H * 0.58)}*215,0,215)'`, "-frames:v", "1", grad]);
    const logo = opt.logo && opt.logo.url ? opt.logo : null;
    const logoFile = logo ? await materialize(logo.url, join(work, "logo")).catch(() => null) : null;
    const accent = opt.accent ?? "#F5C04A";
    const slides: { index: number; key: string; url: string; headline: string; body?: string; kind: string; artUrl: string | null }[] = [];
    for (let i = 0; i < planIn.slides.length; i++) {
      const s = planIn.slides[i];
      onProgress?.(`montando slide ${i + 1}/${planIn.slides.length}`);
      const ass = join(work, `s${i}.ass`);
      await writeFile(ass, slideAss(W, H, s, i, planIn.slides.length, accent, opt.brandName));
      const out = join(work, `slide-${String(i + 1).padStart(2, "0")}.png`);
      const args = ["-hide_banner", "-y"];
      const bg = art[i] ? await materialize(art[i]!, join(work, `bg${i}`)) : null;
      if (bg) args.push("-i", bg);
      else args.push("-f", "lavfi", "-i", `color=c=0x16181d:s=${W}x${H}`);
      args.push("-i", grad);
      const parts = [`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[b]`, `[b][1:v]overlay=0:0[g]`];
      let cur = "g";
      if (logoFile) {
        args.push("-i", logoFile);
        const lw = Math.round(W * Math.min(0.3, Math.max(0.06, logo!.size ?? 0.14)));
        parts.push(`[2:v]scale=${lw}:-1,format=rgba,colorchannelmixer=aa=${Math.min(1, Math.max(0.1, logo!.opacity ?? 0.9)).toFixed(2)}[lg]`);
        const m = Math.round(W * 0.06);
        const pos = logo!.position ?? "top-right";
        parts.push(`[g][lg]overlay=${pos.endsWith("left") ? m : `W-w-${m}`}:${pos.startsWith("top") ? Math.round(H * 0.035) : `H-h-${m}`}[l]`);
        cur = "l";
      }
      parts.push(`[${cur}]subtitles='${ass.replace(/\\/g, "/").replace(/:/g, "\\:")}'[v]`);
      args.push("-filter_complex", parts.join(";"), "-map", "[v]", "-frames:v", "1", out);
      await run(bin, args);
      const stored = await putObject(`${keyPrefix}/slide-${String(i + 1).padStart(2, "0")}.png`, await readFile(out), "image/png");
      slides.push({ index: i + 1, key: stored.key, url: stored.url, headline: s.headline, body: s.body, kind: s.kind, artUrl: art[i] });
    }
    // zip pra postar (o zip do sistema; se não existir, segue sem)
    let zipUrl: string | null = null;
    try {
      const zip = join(work, "carrossel.zip");
      await run("zip", ["-j", "-q", zip, ...slides.map((_, i) => join(work, `slide-${String(i + 1).padStart(2, "0")}.png`))]);
      zipUrl = (await putObject(`${keyPrefix}/carrossel.zip`, await readFile(zip), "application/zip")).url;
    } catch {
      /* sem zip */
    }
    return { slides, zipUrl, caption: planIn.caption, hashtags: planIn.hashtags, title: planIn.title };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
