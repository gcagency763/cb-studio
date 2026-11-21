import { catalogWithAvailability, findModel, zeroCost } from "@g2/providers";
import { createJob, getProject, updateProject } from "./db.js";
import { env } from "./env.js";
import { GenError, enqueue, guard, plan, type GenRequest } from "./generate.js";
import { editQueue, renderQueue } from "./queue.js";
import { splitTake } from "./take.js";

/**
 * Linha de produção do Quadrinhos no servidor — a mesma lógica da mesa de edição,
 * usada pela API (/projects/:id/generate, /render) e pelo MCP.
 */
export type Project = NonNullable<Awaited<ReturnType<typeof getProject>>>;
export type Scene = Project["scenes"][number];
type JobLike = { status: string; output_url: string | null; usage?: any } | null | undefined;

export const isDone = (j: JobLike) => j?.status === "succeeded" && !!j.output_url;
export const isActive = (j: JobLike) => j?.status === "queued" || j?.status === "running";
export const isCard = (s: Scene) => s.type === "card";

/** motor padrão: MiniMax H3 (nível Seedance 2.5, 3–4× mais barato) quando a fal estiver ligada; senão o Seedance grátis */
export const DEFAULT_VIDEO_FREE = "seedance-1-0-pro-fast-251015:720p";
export const DEFAULT_VIDEO_H3 = "minimax-h3:720p";
export const defaultVideo = () => (process.env.FAL_KEY && !zeroCost() ? DEFAULT_VIDEO_H3 : DEFAULT_VIDEO_FREE);
export const DEFAULT_VIDEO = DEFAULT_VIDEO_FREE;

/** motor de vídeo do projeto: "modelo:resolução" (como a mesa salva em video_model) */
export function videoChoice(project: Pick<Project, "video_model">) {
  const [id, res] = (project.video_model ?? defaultVideo()).split(":");
  const model = findModel(id) ?? findModel(DEFAULT_VIDEO.split(":")[0])!;
  const resolution = (res && model.resolutions?.includes(res as any) ? res : model.resolutions?.[0] ?? "720p") as "480p" | "720p" | "1080p";
  return { model, resolution };
}

export type Kind = "image" | "video" | "audio";

/** cenas que ainda precisam daquele ativo (mesma regra da mesa) */
export function pending(project: Project, kind: Kind): Scene[] {
  return project.scenes.filter((s) => {
    if (kind === "image") return !isCard(s) && (s.image_prompt ?? "").trim() && !isDone(s.image_job) && !isActive(s.image_job);
    if (kind === "video") return !isCard(s) && isDone(s.image_job) && (s.motion_prompt ?? "").trim() && !isDone(s.video_job) && !isActive(s.video_job);
    return (s.script ?? "").trim() && !isDone(s.audio_job) && !isActive(s.audio_job);
  });
}

/** cenas cujo vídeo existe mas foi gerado em outro motor/resolução que o escolhido agora (rascunho 480p → final 720p/1080p) */
export function upgradable(project: Project): Scene[] {
  const { model, resolution } = videoChoice(project);
  return project.scenes.filter((s) => {
    const req = (s.video_job?.request ?? {}) as { resolution?: string; model?: string; kind?: string };
    // plano parado (imagem com zoom) foi escolha de quem editou: não entra no "refazer no motor X"
    return !isCard(s) && isDone(s.video_job) && !isActive(s.video_job) && req.kind !== "still" && (req.resolution !== resolution || req.model !== model.id) && isDone(s.image_job) && (s.motion_prompt ?? "").trim();
  });
}

/** por que uma cena não pode gerar aquele ativo agora (ou null se pode) */
export function blocker(scene: Scene, kind: Kind): string | null {
  if (kind === "image") return isCard(scene) ? "cena é um card" : !(scene.image_prompt ?? "").trim() ? "sem prompt de imagem" : null;
  if (kind === "video") return isCard(scene) ? "cena é um card" : !isDone(scene.image_job) ? "gera a imagem antes do vídeo" : !(scene.motion_prompt ?? "").trim() ? "sem prompt de movimento" : null;
  return !(scene.script ?? "").trim() ? "sem texto de narração" : null;
}

export function requestFor(project: Project, scene: Scene, kind: Kind): GenRequest {
  if (kind === "image") return { kind: "image", prompt: scene.image_prompt ?? "", size: "1440x2560" };
  if (kind === "video") {
    const { model, resolution } = videoChoice(project);
    return {
      kind: "video",
      model: model.id,
      prompt: scene.motion_prompt ?? "",
      firstFrame: scene.image_job?.output_url ?? "",
      ratio: "9:16",
      resolution,
      durationSec: Math.min(scene.duration_sec ?? 5, Math.max(...(model.durations ?? [10]))),
      audio: model.nativeAudio ? false : undefined,
    };
  }
  return {
    kind: "audio",
    text: scene.script ?? "",
    voiceRef: project.voice ? { audioUrl: project.voice.reference_url } : undefined,
    style: project.narration_style?.trim() || undefined,
    speechRate: project.speech_rate ?? undefined,
    format: "wav",
    subtitles: true,
  };
}

// ───────────── narração contínua (uma tomada só) ─────────────

/** texto da narração inteira: as falas das cenas, em ordem */
export function narrationText(project: Project) {
  return project.scenes.map((s) => (s.script ?? "").trim()).filter(Boolean).join(" ");
}

/** a tomada contínua pronta e ainda batendo com o roteiro atual (mudou uma fala → precisa gerar de novo) */
export function narrationTake(project: Project & { narration_job?: JobLike & { request?: any } }) {
  const j = project.narration_job;
  if (!isDone(j)) return null;
  return (j as any).request?.text === narrationText(project) ? j : null;
}

/**
 * Gera a narração do projeto inteiro numa chamada só (até ~2 min / 3.000 caracteres no Seed Audio):
 * entonação contínua, sem emenda entre cenas. O render corta as cenas em cima dela pelos tempos das palavras.
 */
export async function startNarration(project: Project, opt: { allowPaid?: boolean } = {}) {
  const text = narrationText(project);
  if (!text) throw new GenError(400, { error: "nenhuma cena tem narração" });
  if (text.length > 3000) throw new GenError(400, { error: `narração tem ${text.length} caracteres — o limite de uma tomada é 3.000; gere por cena` });
  const request: GenRequest = {
    kind: "audio",
    text,
    voiceRef: project.voice ? { audioUrl: project.voice.reference_url } : undefined,
    style: project.narration_style?.trim() || undefined,
    speechRate: project.speech_rate ?? undefined,
    format: "wav",
    subtitles: true,
  } as GenRequest;
  const { provider, cost } = plan(request);
  await guard(request, provider, cost, !!opt.allowPaid);
  const job = await enqueue(request, provider.name, cost, { projectId: project.id });
  await updateProject(project.id, { narration_job_id: job.id });
  return { jobId: job.id, chars: text.length, estimatedCostUsd: cost };
}

/** Só planeja: cenas, custo total e se vai pro cartão. Não gasta nada. */
export function estimateBatch(project: Project, kind: Kind, sceneIds?: string[], mode: "pending" | "upgrade" = "pending") {
  const base = mode === "upgrade" && kind === "video" ? upgradable(project) : pending(project, kind);
  const list = base.filter((s) => !sceneIds || sceneIds.includes(s.id));
  const items = list.map((s) => {
    const request = requestFor(project, s, kind);
    const { provider, cost, paid } = plan(request);
    return { scene: s, request, provider, cost, paid };
  });
  const totalUsd = items.reduce((a, x) => a + x.cost, 0);
  return { items, totalUsd, paid: items.some((x) => x.paid), model: kind === "video" ? videoChoice(project).model.name : kind === "audio" ? project.voice?.name ?? "voz padrão" : "Seedream 4.5" };
}

/**
 * Gera em lote (imagens, vídeos ou narrações) de todas as cenas pendentes.
 * Nada é enfileirado se alguma guarda barrar — ou vai tudo, ou nada.
 */
export async function generateBatch(project: Project, kind: Kind, opts: { sceneIds?: string[]; allowPaid?: boolean; mode?: "pending" | "upgrade" } = {}) {
  const { items, totalUsd, paid } = estimateBatch(project, kind, opts.sceneIds, opts.mode ?? "pending");
  if (!items.length) return { queued: [], totalUsd: 0, paid: false };
  if (paid && !opts.allowPaid) throw new GenError(402, { error: "lote vai pro cartão — confirme com allowPaid:true", estimatedCostUsd: totalUsd, maxJobCostUsd: env.MAX_JOB_COST_USD, paid: true });
  // guardas (voz grátis acumulada no lote; custo por job)
  let voiceSec = 0;
  for (const it of items) {
    await guard(it.request, it.provider, it.cost, !!opts.allowPaid, voiceSec);
    if (it.request.kind === "audio") voiceSec += Math.max(2, String(it.request.text ?? "").length / 15);
  }
  const queued = [];
  for (const it of items) {
    const job = await enqueue(it.request, it.provider.name, it.cost, { projectId: project.id, sceneId: it.scene.id });
    queued.push({ jobId: job.id, sceneId: it.scene.id, position: it.scene.position, estimatedCostUsd: it.cost });
  }
  return { queued, totalUsd, paid };
}

const subtitleOf = (j: JobLike) =>
  isDone(j)
    ? ((j!.usage as any)?.subtitle?.sentences?.map((x: any) => ({ start_time: x.start_time, end_time: x.end_time, text: x.text, words: x.words?.map((w: any) => ({ start_time: w.start_time, end_time: w.end_time, text: w.text })) })) as RenderSentenceLike[] | undefined)
    : undefined;
type RenderSentenceLike = { start_time: number; end_time: number; text: string; words?: { start_time: number; end_time: number; text: string }[] };

/** tempo de fala da cena (da primeira à última palavra), ou null sem narração pronta */
export function spokenSec(scene: Scene): number | null {
  const marks = (subtitleOf(scene.audio_job) ?? []).flatMap((x) => (x.words?.length ? x.words : [x]));
  if (!marks.length) return null;
  return (Math.max(...marks.map((w) => w.end_time)) - Math.min(...marks.map((w) => w.start_time))) / 1000;
}

/**
 * Plano parado: a imagem da cena vira o clipe (zoom de aproximação) no lugar do vídeo de IA — local, grátis.
 * Pra gráfico, tela, documento e texto, que o modelo de vídeo redesenha no meio do plano.
 * Dura a fala da cena (o render não precisa cortar nem congelar); sem narração, a duração da cena.
 */
export async function startStill(project: Project, scene: Scene, opt: { durationSec?: number; zoom?: number; focusX?: number; focusY?: number } = {}) {
  if (isCard(scene)) throw new GenError(400, { error: "cena é um card" });
  if (!isDone(scene.image_job)) throw new GenError(409, { error: "gere a imagem da cena antes" });
  if (isActive(scene.video_job)) throw new GenError(409, { error: "o vídeo dessa cena ainda está gerando — espere terminar" });
  const spoken = spokenSec(scene);
  // mesma conta do render: fala + as margens do corte de silêncio (0,06 + 0,18) + o respiro entre cenas
  const tail = (project.speech_rate ?? 0) >= 10 ? 0.15 : 0.3;
  const durationSec = opt.durationSec ?? (spoken != null ? +(spoken + 0.24 + tail).toFixed(2) : scene.duration_sec ?? 5);
  const options = { durationSec, zoom: opt.zoom ?? 1.18, focusX: opt.focusX ?? 0.5, focusY: opt.focusY ?? 0.45 };
  const job = await createJob({
    kind: "video",
    provider: "ffmpeg",
    request: { kind: "still", model: "still", sourceJobId: scene.image_job_id, prompt: "plano parado (imagem com zoom de aproximação)", ...options } as any,
    estimated_cost_usd: 0,
    project_id: project.id,
    scene_id: scene.id,
  });
  await editQueue.add("still", { jobId: job.id, task: "still", imageUrl: scene.image_job!.output_url!, options }, { jobId: job.id });
  return { jobId: job.id, status: job.status, estimatedCostUsd: 0, durationSec };
}

/**
 * Monta o pedido de render (cards, legendas karaokê com timestamps, trilha).
 * Cena de vídeo SEM texto logo depois de uma cena narrada vira "plano extra": o clipe dela entra
 * na sequência enquanto a fala anterior continua — é assim que se troca de imagem no meio de uma frase.
 */
export function renderRequest(project: Project) {
  const take = narrationTake(project as any);
  if (take) return renderRequestTake(project, take);
  const ready = project.scenes.filter((s) => (isCard(s) ? !!s.card?.text : isDone(s.video_job)));
  const last = project.scenes.length - 1;
  // narração ágil pede respiro curto entre as cenas (o silêncio das pontas do áudio já é cortado no render)
  const tail = (project.speech_rate ?? 0) >= 10 ? 0.15 : 0.3;
  const scenes: any[] = [];
  for (const s of ready) {
    if (isCard(s)) {
      scenes.push({
        card: { text: s.card!.text!, subtext: s.card!.subtext, button: s.card!.button, bgUrl: s.card!.bgUrl ?? (isDone(s.image_job) ? s.image_job!.output_url! : undefined) },
        audioUrl: isDone(s.audio_job) ? s.audio_job!.output_url! : undefined,
        sentences: subtitleOf(s.audio_job),
        durationSec: isDone(s.audio_job) ? undefined : s.duration_sec ?? 2,
        tailSec: s.position === last ? 1.5 : 0.5,
      });
      continue;
    }
    const prev = scenes[scenes.length - 1];
    if (!(s.script ?? "").trim() && prev && !prev.card && prev.audioUrl) {
      // plano extra da fala anterior
      (prev.extraVideoUrls ??= []).push(s.video_job!.output_url!);
      continue;
    }
    scenes.push({
      videoUrl: s.video_job!.output_url!,
      caption: s.script,
      audioUrl: isDone(s.audio_job) ? s.audio_job!.output_url! : undefined,
      sentences: subtitleOf(s.audio_job),
      tailSec: tail,
    });
  }
  const options = { captionStyle: project.caption_style ?? "karaoke", uppercase: project.caption_uppercase ?? true, fontSize: 64, musicUrl: project.music_url ?? undefined, musicVolume: project.music_volume ?? 0.18 };
  return { ready: ready.length, total: project.scenes.length, scenes, options };
}

/** render em cima da tomada contínua: cada cena narrada dura o trecho dela; mudas viram planos extras */
function renderRequestTake(project: Project, take: NonNullable<ReturnType<typeof narrationTake>>) {
  const narrated = project.scenes.filter((s) => (s.script ?? "").trim());
  const spans = splitTake(subtitleOf(take as any) ?? [], narrated.map((s) => s.script!.trim()));
  const spanOf = new Map(narrated.map((s, i) => [s.id, spans[i]]));
  const ready = project.scenes.filter((s) => (isCard(s) ? !!s.card?.text : isDone(s.video_job)));
  const last = project.scenes.length - 1;
  const scenes: any[] = [];
  for (const s of ready) {
    const span = spanOf.get(s.id);
    if (isCard(s)) {
      scenes.push({
        card: { text: s.card!.text!, subtext: s.card!.subtext, button: s.card!.button, bgUrl: s.card!.bgUrl ?? (isDone(s.image_job) ? s.image_job!.output_url! : undefined) },
        ...(span ? { audioSpan: { start: span.start, end: span.end }, sentences: span.sentences, hideCaption: true } : { durationSec: s.duration_sec ?? 2 }),
        tailSec: s.position === last ? 1.2 : 0,
      });
      continue;
    }
    const prev = scenes[scenes.length - 1];
    if (!span && prev && !prev.card && prev.audioSpan) {
      (prev.extraVideoUrls ??= []).push(s.video_job!.output_url!);
      continue;
    }
    scenes.push({
      videoUrl: s.video_job!.output_url!,
      caption: s.script,
      ...(span ? { audioSpan: { start: span.start, end: span.end }, sentences: span.sentences } : {}),
      tailSec: s.position === last ? 1.2 : 0,
    });
  }
  const options = {
    captionStyle: project.caption_style ?? "karaoke",
    uppercase: project.caption_uppercase ?? true,
    fontSize: 64,
    musicUrl: project.music_url ?? undefined,
    musicVolume: project.music_volume ?? 0.18,
    narrationUrl: take.output_url!,
    clipHeadSec: 0.15,
  };
  return { ready: ready.length, total: project.scenes.length, scenes, options, continuous: true };
}

/** Enfileira o render final (FFmpeg local, custo zero). */
export async function startRender(project: Project) {
  const r = renderRequest(project);
  if (!r.scenes.length) throw new GenError(409, { error: "nenhuma cena pronta — gere os vídeos antes de montar", ready: 0, total: r.total });
  const job = await createJob({ kind: "render", provider: "ffmpeg", request: { scenes: r.scenes, options: r.options }, estimated_cost_usd: 0, project_id: project.id });
  await updateProject(project.id, { render_job_id: job.id });
  await renderQueue.add("render", { jobId: job.id, scenes: r.scenes, options: r.options }, { jobId: job.id });
  return { jobId: job.id, ready: r.ready, total: r.total };
}

/** Resumo do que está pronto e o que falta — pro MCP e pra lista de projetos. */
export function status(project: Project) {
  const count = (kind: Kind) => {
    const key = `${kind}_job` as const;
    const scenes = project.scenes.filter((s) => kind === "audio" || !isCard(s));
    return {
      total: scenes.length,
      done: scenes.filter((s) => isDone(s[key])).length,
      running: scenes.filter((s) => isActive(s[key])).length,
      failed: scenes.filter((s) => s[key]?.status === "failed").length,
      pending: pending(project, kind).length,
      ...(kind === "video" ? { upgradable: upgradable(project).length } : {}),
    };
  };
  const { model, resolution } = videoChoice(project);
  return {
    id: project.id,
    title: project.title,
    theme: project.theme,
    style: project.style,
    scenes: project.scenes.length,
    cards: project.scenes.filter(isCard).length,
    hasScript: project.scenes.length > 0,
    voice: project.voice ? { id: project.voice.id, name: project.voice.name } : null,
    videoModel: { id: model.id, name: model.name, resolution, locked: catalogWithAvailability(process.env).find((m) => m.id === model.id)?.locked ?? null },
    image: count("image"),
    video: count("video"),
    audio: count("audio"),
    readyForRender: renderRequest(project).ready,
    render: project.render_job ? { status: project.render_job.status, url: project.render_job.output_url, error: project.render_job.error } : null,
    renderUrl: project.render_job && isDone(project.render_job) ? project.render_job.output_url : null,
  };
}
