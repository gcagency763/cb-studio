import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getJob } from "./db.js";
import { enqueue, GenError, guard, plan, type GenRequest } from "./generate.js";
import { ffmpegBin, materialize, probeDuration, run } from "./render.js";
import { putObject } from "./storage.js";

/**
 * Estender um vídeo (grátis): tira o último frame, o Seedance 1.0 (cota grátis) continua a cena a partir
 * dele com o mesmo prompt de movimento, e o FFmpeg emenda os dois. Corte invisível na maioria das cenas;
 * em movimento rápido pode dar um "solavanco" na emenda.
 */
export interface ExtendOptions { prompt?: string; durationSec?: 5 | 10; resolution?: "480p" | "720p" | "1080p"; model?: string; allowPaid?: boolean }

async function probeSize(bin: string, file: string) {
  const text = await run(bin, ["-hide_banner", "-i", file]).catch((e: Error) => e.message);
  const m = /Video:.*?\s(\d{2,5})x(\d{2,5})/.exec(text);
  return m ? { w: +m[1], h: +m[2] } : { w: 1080, h: 1920 };
}

export async function extendVideo(sourceJobId: string, opt: ExtendOptions, outKey: string, onProgress?: (p: { step: string }) => void) {
  const src = await getJob(sourceJobId);
  if (!src?.output_url) throw new GenError(404, { error: "vídeo de origem não encontrado" });
  const bin = ffmpegBin();
  const work = join(tmpdir(), `g2ext-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await mkdir(work, { recursive: true });
  try {
    onProgress?.({ step: "último frame" });
    const file = await materialize(src.output_url, join(work, "src"));
    const dur = await probeDuration(bin, file);
    const { w, h } = await probeSize(bin, file);
    const last = join(work, "last.png");
    await run(bin, ["-hide_banner", "-y", "-sseof", "-0.15", "-i", file, "-frames:v", "1", "-update", "1", last]);
    const frame = await putObject(`images/${sourceJobId}-last.png`, await readFile(last), "image/png");

    const sreq = (src.request ?? {}) as Partial<GenRequest & { prompt?: string; model?: string; resolution?: string; ratio?: string }>;
    const ratio = (sreq as any).ratio ?? (w > h * 1.3 ? "16:9" : h > w * 1.3 ? "9:16" : "1:1");
    const request = {
      kind: "video" as const,
      model: opt.model ?? (sreq.kind === "video" ? sreq.model : undefined) ?? "seedance-1-0-pro-fast-251015",
      prompt: opt.prompt ?? (sreq.kind === "video" ? sreq.prompt : undefined) ?? "the scene continues naturally with the same motion, lighting and camera; no cut, no new subjects",
      firstFrame: frame.url,
      ratio,
      resolution: opt.resolution ?? (sreq.kind === "video" ? (sreq as any).resolution : undefined) ?? "480p",
      durationSec: opt.durationSec ?? 5,
      audio: false,
      extends: sourceJobId,
    };
    const { provider, cost, paid } = plan(request as GenRequest);
    if (paid && !opt.allowPaid) throw new GenError(402, { error: "esse modelo vai pro cartão — use o Seedance 1.0 (grátis) ou confirme allowPaid:true", estimatedCostUsd: cost, paid: true });
    await guard(request as GenRequest, provider, cost, !!opt.allowPaid);
    onProgress?.({ step: `gerando a continuação (${provider.name})` });
    const gen = await enqueue(request as GenRequest, provider.name, cost, { projectId: src.project_id ?? null });
    const until = Date.now() + 12 * 60_000;
    let ext: Awaited<ReturnType<typeof getJob>> | null = null;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 4000));
      ext = await getJob(gen.id);
      if (ext?.status === "succeeded" && ext.output_url) break;
      if (ext?.status === "failed") throw new Error(`continuação falhou: ${ext.error ?? ""}`);
    }
    if (!ext?.output_url) throw new Error("a continuação demorou demais — veja em Vídeo");

    onProgress?.({ step: "emendando" });
    const extFile = await materialize(ext.output_url, join(work, "ext"));
    const extDur = await probeDuration(bin, extFile);
    const out = join(work, "out.mp4");
    const hasAudio = /Audio:/.test(await run(bin, ["-hide_banner", "-i", file]).catch((e: Error) => e.message));
    const vf = `[1:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=24[e];[0:v]fps=24,setsar=1[s];[s][e]concat=n=2:v=1:a=0[v]`;
    const args = ["-hide_banner", "-y", "-i", file, "-i", extFile, "-filter_complex", hasAudio ? `${vf};[0:a]apad[a]` : vf, "-map", "[v]"];
    if (hasAudio) args.push("-map", "[a]", "-c:a", "aac", "-b:a", "160k", "-shortest");
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out);
    await run(bin, args);
    const stored = await putObject(outKey, await readFile(out), "video/mp4");
    return { ...stored, durationSec: +(dur + extDur).toFixed(2), sourceDurationSec: dur, extensionJobId: gen.id, lastFrameUrl: frame.url, cost };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Upscale sem IA (grátis): lanczos + nitidez leve pra 1080p ou 4K, e 60 fps por interpolação de movimento
 * (minterpolate — lento, ~1 min por 10 s). Serve pra YouTube/TV; o Topaz/FLUX (fal, pago) recupera detalhe de verdade.
 */
export async function upscaleVideo(sourceJobId: string, opt: { to?: "1080p" | "4k"; fps60?: boolean }, outKey: string, onProgress?: (p: { step: string }) => void) {
  const src = await getJob(sourceJobId);
  if (!src?.output_url) throw new GenError(404, { error: "vídeo de origem não encontrado" });
  const bin = ffmpegBin();
  const work = join(tmpdir(), `g2up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await mkdir(work, { recursive: true });
  try {
    const file = await materialize(src.output_url, join(work, "src"));
    const { w, h } = await probeSize(bin, file);
    const short = opt.to === "4k" ? 2160 : 1080;
    const portrait = h >= w;
    const tw = portrait ? short : Math.round((short * w) / h / 2) * 2;
    const th = portrait ? Math.round((short * h) / w / 2) * 2 : short;
    onProgress?.({ step: opt.fps60 ? "ampliando + 60 fps (lento)" : "ampliando" });
    const vf = [`scale=${tw}:${th}:flags=lanczos`, "unsharp=5:5:0.5:3:3:0.0", ...(opt.fps60 ? ["minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"] : [])].join(",");
    const out = join(work, "out.mp4");
    await run(bin, ["-hide_banner", "-y", "-i", file, "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", out]);
    const stored = await putObject(outKey, await readFile(out), "video/mp4");
    return { ...stored, width: tw, height: th, fps: opt.fps60 ? 60 : undefined };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Plano parado (grátis, local): a imagem da cena vira o clipe, com um zoom de aproximação que desacelera.
 * Pra gráfico, tela, documento e texto — o vídeo de IA redesenha esses elementos no meio do plano —
 * e pra poupar a cota de vídeo em planos que não precisam de movimento.
 */
export interface StillOptions {
  durationSec?: number;
  /** zoom final (1.18 = aproxima 18%) */
  zoom?: number;
  /** ponto que fica no lugar enquanto aproxima (0..1 da imagem) */
  focusX?: number;
  focusY?: number;
  width?: number;
  height?: number;
}

export async function stillClip(imageUrl: string, opt: StillOptions, outKey: string) {
  const bin = ffmpegBin();
  const work = join(tmpdir(), `g2still-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await mkdir(work, { recursive: true });
  try {
    const img = await materialize(imageUrl, join(work, "img"));
    const W = opt.width ?? 1080;
    const H = opt.height ?? 1920;
    const fps = 24;
    const dur = Math.min(15, Math.max(1.5, opt.durationSec ?? 5));
    const n = Math.round(dur * fps);
    const amount = Math.min(0.6, Math.max(0, (opt.zoom ?? 1.18) - 1));
    const unit = (v: number | undefined, d: number) => Math.min(1, Math.max(0, v ?? d)).toFixed(3);
    // a imagem entra com o dobro do tamanho: o zoompan arredonda a janela em pixels inteiros e, no tamanho final, isso treme
    const vf = [
      `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase:flags=lanczos`,
      `crop=${W * 2}:${H * 2}`,
      `zoompan=z='1+${amount.toFixed(3)}*(1-pow(1-on/${n},2))':x='(iw-iw/zoom)*${unit(opt.focusX, 0.5)}':y='(ih-ih/zoom)*${unit(opt.focusY, 0.45)}':d=${n}:s=${W}x${H}:fps=${fps}`,
      "setsar=1",
    ].join(",");
    const out = join(work, "out.mp4");
    await run(bin, ["-hide_banner", "-y", "-i", img, "-vf", vf, "-frames:v", String(n), "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
    const stored = await putObject(outKey, await readFile(out), "video/mp4");
    return { ...stored, durationSec: +(n / fps).toFixed(2), width: W, height: H };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
