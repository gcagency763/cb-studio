import { Worker } from "bullmq";
import { providersFromEnv } from "@g2/providers";
import { createJob, createProject, getJob, getProject, replaceScenes, updateJob, updateProject } from "./lib/db.js";
import { writeCampaignScripts } from "./lib/ads.js";
import { dubVideo } from "./lib/dub.js";
import { renderCarousel, writeCarousel } from "./lib/carousel.js";
import { extendVideo, stillClip, upscaleVideo } from "./lib/extend.js";
import { checkTake } from "./lib/take.js";
import { analyzeReference, captionVideo, loadTranscript, pickCuts, referenceToText, renderCuts, renderOneCut, saveTranscript, transcribe } from "./lib/edit.js";
import { generateScript } from "./lib/script.js";
import { EDIT_QUEUE, GENERATION_QUEUE, RENDER_QUEUE, editQueue, generationQueue, redis, renderQueue, type EditJobData, type GenerationJobData, type RenderJobData } from "./lib/queue.js";
import { sql } from "./lib/db.js";
import { resolveRequestRefs } from "./lib/refs.js";
import { renderProject } from "./lib/render.js";
import { extFor, putObject, s3On, trimCache } from "./lib/storage.js";

const providers = providersFromEnv();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Worker: submit → poll até terminar → baixa → persiste → marca sucesso.
 * (as chamadas aos provedores têm prazo — conexão travada vira erro e o BullMQ tenta de novo)
 * Vídeo leva 1–3 min; imagem é quase imediata.
 */
const worker = new Worker<GenerationJobData>(
  GENERATION_QUEUE,
  async (job) => {
    const { jobId, provider, request } = job.data;
    const p = providers[provider];
    if (!p) throw new Error(`provider ${provider} não configurado no worker`);

    // retomada: se já foi submetido ao provedor (worker reiniciou no meio), só volta a acompanhar — nunca gera duas vezes
    const existing = await getJob(jobId);
    let providerJobId = existing?.provider_job_id ?? null;
    if (existing?.status === "succeeded" && existing.output_url) return { url: existing.output_url };
    if (!providerJobId) {
      // "/storage/..." → base64 (dev) ou URL pública do R2 (prod)
      const resolved = await resolveRequestRefs(request);
      ({ providerJobId } = await p.submit(resolved));
      await updateJob(jobId, { status: "running", provider_job_id: providerJobId });
    }

    const deadline = Date.now() + 15 * 60_000;
    let delay = request.kind === "video" || request.kind === "avatar" || request.kind === "lipsync" ? 5_000 : request.kind === "audio" || request.kind === "sfx" ? 500 : 2_000;
    while (Date.now() < deadline) {
      const r = await p.poll(providerJobId);
      if (r.status === "succeeded") {
        if (!r.outputBytes && !r.outputUrl) throw new Error("sucesso sem resultado");
        const bytes = r.outputBytes ?? (await p.download(r.outputUrl!));
        const isVideo = request.kind === "video" || request.kind === "avatar" || request.kind === "lipsync";
        const isAudio = request.kind === "audio" || request.kind === "sfx";
        const contentType = r.contentType ?? (isVideo ? "video/mp4" : isAudio ? "audio/wav" : "image/png");
        const folder = isVideo ? "videos" : isAudio ? "audios" : "images";
        const key = `${folder}/${jobId}.${extFor(contentType)}`;
        const stored = await putObject(key, bytes, contentType);
        // narração: confere se a voz falou todas as palavras do texto (às vezes pula uma)
        const subtitle = (r.meta as { subtitle?: { sentences?: { words?: { text: string }[] }[] } } | undefined)?.subtitle;
        const check = request.kind === "audio" && typeof (request as { text?: string }).text === "string" && subtitle?.sentences?.length ? checkTake((request as { text: string }).text, subtitle.sentences) : undefined;
        await updateJob(jobId, {
          status: "succeeded",
          output_url: stored.url,
          storage_key: stored.key,
          usage: { ...(r.usage ?? {}), ...(r.meta ?? {}), ...(check ? { check } : {}) },
        });
        return { url: stored.url };
      }
      if (r.status === "failed") {
        await updateJob(jobId, { status: "failed", error: r.error ?? "falha no provedor" });
        throw new Error(r.error ?? "falha no provedor");
      }
      await job.updateProgress({ providerStatus: r.status });
      await sleep(delay);
      delay = Math.min(delay * 1.5, 15_000);
    }
    await updateJob(jobId, { status: "failed", error: "timeout (15 min)" });
    throw new Error("timeout");
  },
  // quase tudo aqui é espera de rede (o provedor gera); a BytePlus aceita 10 tarefas simultâneas por modelo
  { connection: redis, concurrency: Number(process.env.GENERATION_CONCURRENCY ?? 8) },
);

worker.on("completed", (j) => console.log(`[worker] job ${j.id} ok`));
worker.on("failed", (j, err) => console.error(`[worker] job ${j?.id} falhou:`, err.message));

/** Render local com FFmpeg — montagem + legenda. */
const renderWorker = new Worker<RenderJobData>(
  RENDER_QUEUE,
  async (job) => {
    const { jobId, scenes, options } = job.data;
    await updateJob(jobId, { status: "running", provider_job_id: `ffmpeg:${jobId}` });
    try {
      const out = await renderProject(scenes, options, `renders/${jobId}.mp4`, (p) => job.updateProgress(p));
      await updateJob(jobId, {
        status: "succeeded",
        output_url: out.url,
        storage_key: out.key,
        usage: { durationSec: out.durationSec, scenes: scenes.length },
      });
      return out;
    } catch (e: any) {
      await updateJob(jobId, { status: "failed", error: e.message?.slice(0, 2000) });
      throw e;
    }
  },
  { connection: redis, concurrency: 1 },
);
renderWorker.on("completed", (j) => console.log(`[render] job ${j.id} ok`));
renderWorker.on("failed", (j, err) => console.error(`[render] job ${j?.id} falhou:`, err.message.split("\n")[0]));

/** Edição local: transcrição (Whisper no Docker), legenda karaokê, cortes virais. */
const editWorker = new Worker<EditJobData>(
  EDIT_QUEUE,
  async (job) => {
    const d = job.data;
    await updateJob(d.jobId, { status: "running", provider_job_id: `local:${d.jobId}` });
    try {
      if (d.task === "upscale-video") {
        const out = await upscaleVideo(d.sourceJobId, d.options, `videos/${d.jobId}.mp4`, (p) => job.updateProgress(p));
        await updateJob(d.jobId, { status: "succeeded", output_url: out.url, storage_key: out.key, usage: { width: out.width, height: out.height, fps: out.fps, sourceJobId: d.sourceJobId } });
        return out;
      }
      if (d.task === "still") {
        const out = await stillClip(d.imageUrl, d.options, `videos/${d.jobId}.mp4`);
        await updateJob(d.jobId, { status: "succeeded", output_url: out.url, storage_key: out.key, usage: { durationSec: out.durationSec, width: out.width, height: out.height, still: true } });
        return out;
      }
      if (d.task === "extend") {
        const out = await extendVideo(d.sourceJobId, d.options, `videos/${d.jobId}.mp4`, (p) => job.updateProgress(p));
        await updateJob(d.jobId, { status: "succeeded", output_url: out.url, storage_key: out.key, usage: { durationSec: out.durationSec, sourceDurationSec: out.sourceDurationSec, extensionJobId: out.extensionJobId, lastFrameUrl: out.lastFrameUrl } });
        return out;
      }
      if (d.task === "carousel") {
        await job.updateProgress({ step: "escrevendo os slides" });
        const planned = await writeCarousel(d.options);
        const out = await renderCarousel(planned, d.options, `carousel/${d.jobId}`, (st) => job.updateProgress({ step: st }));
        await updateJob(d.jobId, { status: "succeeded", output_url: out.slides[0]?.url ?? null, storage_key: out.slides[0]?.key ?? null, usage: { title: out.title, slides: out.slides, zipUrl: out.zipUrl, caption: out.caption, hashtags: out.hashtags, count: out.slides.length } });
        return out;
      }
      if (d.task === "batch") {
        const results = await writeCampaignScripts(d.campaignId, { scenes: d.scenes, style: d.style, audience: d.audience, tone: d.tone }, (p) => job.updateProgress(p));
        await updateJob(d.jobId, { status: "succeeded", output_url: null, usage: { campaignId: d.campaignId, projects: results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length } });
        return { results };
      }
      // transcrição: reaproveita se veio pronta, senão transcreve e guarda
      const getTranscript = async () => {
        if ("transcriptUrl" in d && d.transcriptUrl) return { t: await loadTranscript(d.transcriptUrl), url: d.transcriptUrl };
        const t = await transcribe(d.videoUrl, (p) => job.updateProgress(p));
        const stored = await saveTranscript(`transcripts/${d.jobId}.json`, t);
        return { t, url: stored.url };
      };

      if (d.task === "transcribe") {
        const { t, url } = await getTranscript();
        await updateJob(d.jobId, { status: "succeeded", output_url: url, storage_key: url.replace(/^\/storage\//, ""), usage: { durationSec: t.durationSec, segments: t.segments.length, words: t.segments.reduce((a, s) => a + s.words.length, 0), language: t.language, model: t.model, seconds: t.durationSec } });
        return { url };
      }
      if (d.task === "caption") {
        const { t, url: transcriptUrl } = await getTranscript();
        const out = await captionVideo(d.videoUrl, t, d.options, `cuts/${d.jobId}.mp4`, (p) => job.updateProgress(p));
        await updateJob(d.jobId, { status: "succeeded", output_url: out.url, storage_key: out.key, usage: { durationSec: out.durationSec, transcriptUrl, format: d.options.format ?? "9:16", broll: out.broll } });
        return out;
      }
      if (d.task === "cuts") {
        const { t, url: transcriptUrl } = await getTranscript();
        await job.updateProgress({ step: "escolhendo trechos" });
        const picks = await pickCuts(t, d.options);
        if (!picks.length) throw new Error("não achei trechos bons o bastante — tente mais cortes ou outro vídeo");
        const clips = await renderCuts(d.videoUrl, t, picks, d.options, `cuts/${d.jobId}`, (p) => job.updateProgress(p));
        // cada clipe vira um job próprio (aparece na biblioteca e no histórico de Cortes)
        const children = [];
        for (const c of clips) {
          const child = await createJob({ kind: "cut", provider: "ffmpeg", request: { kind: "cut", parentJobId: d.jobId, sourceUrl: d.videoUrl, index: c.index, start: c.pick.start, end: c.pick.end, title: c.pick.title, hook: c.pick.hook, reason: c.pick.reason, score: c.pick.score, format: d.options.format ?? "9:16" }, estimated_cost_usd: 0 });
          await updateJob(child.id, { status: "succeeded", output_url: c.url, storage_key: c.key, usage: { durationSec: c.durationSec, score: c.pick.score, title: c.pick.title } });
          children.push({ jobId: child.id, index: c.index, url: c.url, durationSec: c.durationSec, title: c.pick.title, score: c.pick.score, start: c.pick.start, end: c.pick.end });
        }
        await updateJob(d.jobId, { status: "succeeded", output_url: children[0]?.url ?? null, storage_key: null, usage: { transcriptUrl, clips: children, count: children.length } });
        return { clips: children };
      }
      if (d.task === "cut") {
        const { t } = await getTranscript();
        const out = await renderOneCut(d.videoUrl, t, { start: d.start, end: d.end }, d.title, d.options, `cuts/${d.jobId}.mp4`, (p) => job.updateProgress(p));
        await updateJob(d.jobId, { status: "succeeded", output_url: out.url, storage_key: out.key, usage: { durationSec: out.durationSec, title: d.title, start: d.start, end: d.end } });
        return out;
      }
      if (d.task === "dub") {
        const { t, url: transcriptUrl } = await getTranscript();
        const out = await dubVideo(d.videoUrl, t, d.options, `cuts/${d.jobId}.mp4`, (p) => job.updateProgress(p));
        const dubbedUrl = (await saveTranscript(`transcripts/${d.jobId}-${d.options.language}.json`, out.transcript)).url;
        await updateJob(d.jobId, {
          status: "succeeded",
          output_url: out.url,
          storage_key: out.key,
          usage: { durationSec: out.durationSec, transcriptUrl: dubbedUrl, sourceTranscriptUrl: transcriptUrl, language: out.language, chunks: out.chunks, seconds: out.voiceSeconds, translation: out.translation, format: d.options.format ?? "original" },
        });
        return { url: out.url };
      }
      if (d.task === "recreate") {
        const { t, url: transcriptUrl } = await getTranscript();
        await job.updateProgress({ step: "analisando a referência" });
        const analysis = await analyzeReference(t, d.context);
        await job.updateProgress({ step: "escrevendo o roteiro" });
        const apiKey = process.env.ARK_API_KEY;
        if (!apiKey) throw new Error("ARK_API_KEY ausente");
        const out = await generateScript({ theme: d.theme, scenes: d.scenes ?? Math.min(12, Math.max(5, analysis.scenesSuggested || 8)), style: d.style ?? "epic", audience: d.audience, tone: d.tone, reference: referenceToText(analysis) }, { apiKey, baseUrl: process.env.ARK_BASE_URL, model: process.env.ARK_TEXT_MODEL });
        let projectId = d.projectId;
        if (projectId) {
          if (!(await getProject(projectId))) throw new Error("projeto não encontrado");
          await updateProject(projectId, { title: out.title, theme: d.theme, style: d.style ?? "epic", character_sheet: out.character_sheet, reference: { ...analysis, transcriptUrl, videoUrl: d.videoUrl } });
        } else {
          const p = await createProject({ title: out.title, kind: "comic", theme: d.theme, style: d.style ?? "epic" });
          projectId = p.id;
          await updateProject(projectId, { character_sheet: out.character_sheet, voice_id: d.voiceId ?? null, reference: { ...analysis, transcriptUrl, videoUrl: d.videoUrl } });
        }
        await replaceScenes(projectId, out.scenes.map((s) => ({ ...s, card: s.card ?? null })));
        await updateJob(d.jobId, { status: "succeeded", output_url: null, usage: { projectId, title: out.title, scenes: out.scenes.length, transcriptUrl, analysis } });
        return { projectId };
      }
      throw new Error("tarefa desconhecida");
    } catch (e: any) {
      await updateJob(d.jobId, { status: "failed", error: e.message?.slice(0, 2000) });
      throw e;
    }
  },
  { connection: redis, concurrency: 1 },
);
editWorker.on("completed", (j) => console.log(`[edit] job ${j.id} ok`));
editWorker.on("failed", (j, err) => console.error(`[edit] job ${j?.id} falhou:`, err.message.split("\n")[0]));

/**
 * Varredura ao subir: jobs que ficaram "queued/running" no banco sem job vivo na fila
 * (worker reiniciado no meio) viram "failed: interrompido" — senão ficam girando pra sempre na UI.
 * Jobs de edição ainda na fila são deixados em paz (vão rodar).
 */
async function sweepOrphans() {
  try {
    const rows = await sql<{ id: string; kind: string; provider: string }[]>`
      select id, kind, provider from jobs where status in ('queued','running') and kind not in ('cut','publish') and created_at > now() - interval '2 days'`;
    for (const r of rows) {
      // o job pode estar em qualquer fila (ex.: kind "video" feito pela fila de edição: estender, ampliar)
      let state = "missing";
      for (const q of [generationQueue, renderQueue, editQueue]) {
        const j = await q.getJob(r.id);
        if (j) {
          state = await j.getState();
          break;
        }
      }
      if (state === "missing" || state === "failed" || state === "completed") {
        await updateJob(r.id, { status: "failed", error: "interrompido (o estúdio reiniciou no meio) — gere de novo" });
        console.warn(`[worker] job ${r.id} (${r.kind}) marcado como interrompido (${state})`);
      }
    }
  } catch (e: any) {
    console.warn("[worker] varredura falhou:", e.message);
  }
}
setTimeout(sweepOrphans, 4000);

// nuvem: disco é cache do bucket — de hora em hora limpa os arquivos mais antigos que já estão no bucket
if (s3On()) {
  const trim = () =>
    trimCache()
      .then((r) => r.removed && console.log(`[worker] cache: ${r.removed} arquivos (${(r.freedBytes / 1024 ** 2).toFixed(0)} MB) saíram do disco — continuam no bucket`))
      .catch((e) => console.warn("[worker] limpeza do cache falhou:", e.message));
  setTimeout(trim, 60_000);
  setInterval(trim, 60 * 60_000);
}

console.log(`[worker] ouvindo filas "${GENERATION_QUEUE}", "${RENDER_QUEUE}" e "${EDIT_QUEUE}" com providers: ${Object.keys(providers).join(", ") || "(nenhum)"}`);
