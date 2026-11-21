import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createJob, getJob, getProject, getSetting, setSetting, sql, updateProject, type JobRow } from "../lib/db.js";
import type { BrandLogo } from "../lib/edit.js";
import { editEnv, ensureWhisper, exportTranscript, loadTranscript, reviewVirality, whisperHealthy, wordsBetween, writeCopy } from "../lib/edit.js";
import { editQueue } from "../lib/queue.js";

/**
 * Edição de vídeo gravado — local e grátis (Whisper no Docker + FFmpeg):
 *   POST /transcribe  vídeo → transcrição com palavras
 *   POST /caption     vídeo → MP4 com legenda karaokê (9:16 opcional)
 *   POST /cuts        vídeo longo → N cortes virais legendados
 */
const formatSchema = z.enum(["9:16", "original", "1:1", "16:9"]);
const videoRef = z.string().min(1).describe("/storage/uploads/... ou URL");

/** transcrição já feita pra esse vídeo? (evita transcrever de novo) */
async function existingTranscript(videoUrl: string): Promise<string | undefined> {
  const [row] = await sql<{ url: string | null }[]>`
    select coalesce(case when kind = 'transcribe' then output_url end, usage->>'transcriptUrl') as url
    from jobs where status = 'succeeded' and request->>'videoUrl' = ${videoUrl}
      and (kind = 'transcribe' or usage->>'transcriptUrl' is not null)
    order by created_at desc limit 1`;
  return row?.url ?? undefined;
}

export type Brand = { logo?: BrandLogo | null; name?: string };

/** logo da marca (Provedores → Marca) pra carimbar nos cortes/legendas; `false` no pedido desliga */
async function brandLogo(flag?: boolean): Promise<BrandLogo | false> {
  if (flag === false) return false;
  const b = await getSetting<Brand>("brand");
  return b?.logo?.url ? b.logo : false;
}

export async function editRoutes(app: FastifyInstance) {
  /** marca: logo (PNG com fundo transparente), canto, tamanho e opacidade */
  app.get("/brand", async () => ({ brand: (await getSetting<Brand>("brand")) ?? {} }));
  app.put("/brand", async (req) => {
    const body = z.object({ name: z.string().max(80).optional(), logo: z.object({ url: z.string().min(1), position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(), size: z.number().min(0.05).max(0.4).optional(), opacity: z.number().min(0.1).max(1).optional() }).nullable().optional() }).parse(req.body);
    const cur = (await getSetting<Brand>("brand")) ?? {};
    const next: Brand = { ...cur, ...(body.name !== undefined ? { name: body.name } : {}), ...(body.logo !== undefined ? { logo: body.logo } : {}) };
    await setSetting("brand", next);
    return { brand: next };
  });

  /** serviço de transcrição no ar? modelo? (e sobe sozinho se estiver fora) */
  app.get("/edit/status", async () => {
    const st = await ensureWhisper();
    return { whisper: st.healthy, starting: st.starting, model: editEnv.model, language: editEnv.language, url: editEnv.whisperUrl };
  });
  app.post("/edit/start", async () => ensureWhisper());

  app.post("/transcribe", async (req, reply) => {
    const body = z.object({ videoUrl: videoRef }).parse(req.body);
    const job = await createJob({ kind: "transcribe", provider: "whisper", request: { kind: "transcribe", videoUrl: body.videoUrl }, estimated_cost_usd: 0 });
    await editQueue.add("transcribe", { jobId: job.id, task: "transcribe", videoUrl: body.videoUrl }, { jobId: job.id });
    return reply.code(202).send({ jobId: job.id, status: job.status, estimatedCostUsd: 0 });
  });

  /** url da transcrição de qualquer job (transcribe → output; caption/cuts/recreate → usage.transcriptUrl) */
  const transcriptUrlOf = (job: JobRow | null) => (job?.kind === "transcribe" ? job.output_url : ((job?.usage as any)?.transcriptUrl as string | undefined)) ?? null;

  app.get("/transcripts/:jobId", async (req, reply) => {
    const job = await getJob((req.params as { jobId: string }).jobId);
    const url = transcriptUrlOf(job);
    if (!job || !url) return reply.code(404).send({ error: "transcrição não encontrada" });
    const { full } = (req.query ?? {}) as { full?: string };
    const t = await loadTranscript(url);
    return { jobId: job.id, status: job.status, url, durationSec: t.durationSec, language: t.language, model: t.model, text: t.text, segments: full ? t.segments : t.segments.map((s) => ({ start: s.start, end: s.end, text: s.text })) };
  });

  /** legendas pra YouTube/CapCut: .srt, .vtt ou .txt (short=0 usa os segmentos inteiros) */
  app.get("/transcripts/:jobId/export", async (req, reply) => {
    const job = await getJob((req.params as { jobId: string }).jobId);
    const url = transcriptUrlOf(job);
    if (!job || !url) return reply.code(404).send({ error: "transcrição não encontrada" });
    const q = (req.query ?? {}) as { format?: string; short?: string };
    const format = (["srt", "vtt", "txt"].includes(q.format ?? "") ? q.format : "srt") as "srt" | "vtt" | "txt";
    const text = exportTranscript(await loadTranscript(url), format, { short: q.short !== "0" });
    const mime = format === "vtt" ? "text/vtt" : "text/plain";
    return reply.type(`${mime}; charset=utf-8`).header("content-disposition", `attachment; filename="legenda-${job.id.slice(0, 8)}.${format}"`).send(text);
  });

  app.post("/caption", async (req, reply) => {
    const body = z
      .object({
        videoUrl: videoRef,
        transcriptUrl: z.string().optional(),
        format: formatSchema.optional(),
        fontSize: z.number().int().min(24).max(140).optional(),
        uppercase: z.boolean().optional(),
        captionStyle: z.enum(["karaoke", "sentence"]).optional(),
        highlightColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        title: z.string().max(80).optional(),
        cutSilence: z.boolean().optional(),
        cutFillers: z.boolean().optional(),
        zooms: z.boolean().optional(),
        broll: z.number().int().min(0).max(12).optional(),
        brollStyle: z.enum(["cinematic", "epic", "comic", "anime", "flat"]).optional(),
        context: z.string().max(600).optional(),
        reframe: z.enum(["face", "center"]).optional(),
        logo: z.boolean().optional(),
      })
      .parse(req.body);
    const transcriptUrl = body.transcriptUrl ?? (await existingTranscript(body.videoUrl));
    const options = { format: body.format ?? "9:16", fontSize: body.fontSize, uppercase: body.uppercase, captionStyle: body.captionStyle, highlightColor: body.highlightColor, title: body.title, cutSilence: body.cutSilence, cutFillers: body.cutFillers ?? body.cutSilence, zooms: body.zooms, broll: body.broll, brollStyle: body.brollStyle, context: body.context, reframe: body.reframe ?? "face", logo: await brandLogo(body.logo) };
    const job = await createJob({ kind: "caption", provider: "ffmpeg", request: { kind: "caption", videoUrl: body.videoUrl, transcriptUrl, ...options }, estimated_cost_usd: 0 });
    await editQueue.add("caption", { jobId: job.id, task: "caption", videoUrl: body.videoUrl, transcriptUrl, options }, { jobId: job.id });
    return reply.code(202).send({ jobId: job.id, status: job.status, estimatedCostUsd: 0, reusedTranscript: !!transcriptUrl });
  });

  app.post("/cuts", async (req, reply) => {
    const body = z
      .object({
        videoUrl: videoRef,
        transcriptUrl: z.string().optional(),
        count: z.number().int().min(1).max(20).optional(),
        minSec: z.number().int().min(10).max(120).optional(),
        maxSec: z.number().int().min(15).max(180).optional(),
        context: z.string().max(600).optional(),
        format: formatSchema.optional(),
        cutSilence: z.boolean().optional(),
        cutFillers: z.boolean().optional(),
        zooms: z.boolean().optional(),
        broll: z.number().int().min(0).max(4).optional(),
        brollStyle: z.enum(["cinematic", "epic", "comic", "anime", "flat"]).optional(),
        reframe: z.enum(["face", "center"]).optional(),
        logo: z.boolean().optional(),
      })
      .parse(req.body);
    const transcriptUrl = body.transcriptUrl ?? (await existingTranscript(body.videoUrl));
    const options = { count: body.count ?? 6, minSec: body.minSec ?? 25, maxSec: body.maxSec ?? 70, context: body.context, format: body.format ?? "9:16", cutSilence: body.cutSilence ?? true, cutFillers: body.cutFillers ?? body.cutSilence ?? true, zooms: body.zooms ?? true, broll: body.broll ?? 0, brollStyle: body.brollStyle, reframe: body.reframe ?? "face", logo: await brandLogo(body.logo) };
    const job = await createJob({ kind: "cuts", provider: "ffmpeg", request: { kind: "cuts", videoUrl: body.videoUrl, transcriptUrl, ...options }, estimated_cost_usd: 0 });
    await editQueue.add("cuts", { jobId: job.id, task: "cuts", videoUrl: body.videoUrl, transcriptUrl, options }, { jobId: job.id });
    return reply.code(202).send({ jobId: job.id, status: job.status, estimatedCostUsd: 0, reusedTranscript: !!transcriptUrl });
  });

  /** estende um vídeo: último frame → Seedance continua (cota grátis) → emenda */
  app.post("/videos/:jobId/extend", async (req, reply) => {
    const src = await getJob((req.params as { jobId: string }).jobId);
    if (!src?.output_url || !["video", "cut", "caption", "render", "dub", "avatar", "lipsync"].includes(src.kind)) return reply.code(404).send({ error: "vídeo não encontrado" });
    const body = z.object({ prompt: z.string().max(800).optional(), durationSec: z.union([z.literal(5), z.literal(10)]).optional(), resolution: z.enum(["480p", "720p", "1080p"]).optional(), model: z.string().optional(), allowPaid: z.boolean().optional() }).parse(req.body ?? {});
    const options = { prompt: body.prompt, durationSec: body.durationSec ?? 5, resolution: body.resolution, model: body.model, allowPaid: !!body.allowPaid };
    const job = await createJob({ kind: "video", provider: "ffmpeg", request: { kind: "extend", sourceJobId: src.id, prompt: options.prompt ?? (src.request as any)?.prompt, durationSec: options.durationSec, resolution: options.resolution, model: options.model }, estimated_cost_usd: 0, project_id: src.project_id ?? null });
    await editQueue.add("extend", { jobId: job.id, task: "extend", sourceJobId: src.id, options }, { jobId: job.id });
    return reply.code(202).send({ jobId: job.id, status: job.status, estimatedCostUsd: 0, note: "continuação pelo Seedance 1.0 na cota grátis; o custo nominal aparece no job da continuação" });
  });

  /** upscale sem IA (lanczos + nitidez; 60 fps opcional) — grátis, local */
  app.post("/videos/:jobId/upscale", async (req, reply) => {
    const src = await getJob((req.params as { jobId: string }).jobId);
    if (!src?.output_url) return reply.code(404).send({ error: "vídeo não encontrado" });
    const body = z.object({ to: z.enum(["1080p", "4k"]).optional(), fps60: z.boolean().optional() }).parse(req.body ?? {});
    const options = { to: body.to ?? "1080p", fps60: !!body.fps60 };
    const job = await createJob({ kind: "video", provider: "ffmpeg", request: { kind: "upscale-video", sourceJobId: src.id, prompt: `${(src.request as any)?.prompt ?? ""} (upscale ${options.to}${options.fps60 ? " 60fps" : ""})`.trim(), ...options }, estimated_cost_usd: 0, project_id: src.project_id ?? null });
    await editQueue.add("upscale-video", { jobId: job.id, task: "upscale-video", sourceJobId: src.id, options }, { jobId: job.id });
    return reply.code(202).send({ jobId: job.id, status: job.status, estimatedCostUsd: 0 });
  });

  /** carrossel de Instagram: tema → slides escritos + arte gerada + texto composto → PNGs e zip */
  app.post("/carousel", async (req, reply) => {
    const body = z
      .object({
        theme: z.string().min(3).max(600),
        slides: z.number().int().min(3).max(10).optional(),
        style: z.string().optional(),
        audience: z.string().max(200).optional(),
        tone: z.string().max(200).optional(),
        context: z.string().max(600).optional(),
        format: z.enum(["4:5", "1:1"]).optional(),
        accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        logo: z.boolean().optional(),
        brandName: z.string().max(40).optional(),
      })
      .parse(req.body);
    const brand = (await getSetting<Brand>("brand")) ?? {};
    const options = { ...body, format: body.format ?? "4:5", style: body.style ?? "flat", logo: await brandLogo(body.logo), brandName: body.brandName ?? brand.name };
    const n = body.slides ?? 7;
    const job = await createJob({ kind: "carousel", provider: "seedream", request: { kind: "carousel", ...options }, estimated_cost_usd: +(n * 0.04).toFixed(2) });
    await editQueue.add("carousel", { jobId: job.id, task: "carousel", options }, { jobId: job.id });
    return reply.code(202).send({ jobId: job.id, status: job.status, estimatedCostUsd: +(n * 0.04).toFixed(2), note: "imagens pela cota grátis do Seedream" });
  });

  /** refaz um corte com limites/título ajustados na mão (novo job 'cut' do mesmo pai) */
  app.post("/cuts/:jobId/rerender", async (req, reply) => {
    const parent = await getJob((req.params as { jobId: string }).jobId);
    if (!parent || (parent.kind !== "cut" && parent.kind !== "cuts")) return reply.code(404).send({ error: "corte não encontrado" });
    const body = z
      .object({
        start: z.number().min(0),
        end: z.number().min(1),
        title: z.string().max(80).optional(),
        format: formatSchema.optional(),
        cutSilence: z.boolean().optional(),
        cutFillers: z.boolean().optional(),
        zooms: z.boolean().optional(),
        reframe: z.enum(["face", "center"]).optional(),
        broll: z.number().int().min(0).max(4).optional(),
        brollStyle: z.enum(["cinematic", "epic", "comic", "anime", "flat"]).optional(),
        logo: z.boolean().optional(),
      })
      .parse(req.body);
    if (body.end - body.start < 3) return reply.code(400).send({ error: "corte precisa ter pelo menos 3 s" });
    if (body.end - body.start > 300) return reply.code(400).send({ error: "corte de no máximo 5 min" });
    const req0 = (parent.request ?? {}) as any;
    const isChild = parent.kind === "cut";
    const videoUrl: string = isChild ? req0.sourceUrl : req0.videoUrl;
    const parentId: string = isChild ? req0.parentJobId : parent.id;
    const parentJob = isChild ? await getJob(parentId) : parent;
    const transcriptUrl = (((parentJob?.usage as any)?.transcriptUrl as string | undefined) ?? (await existingTranscript(videoUrl))) || undefined;
    const options = {
      format: body.format ?? req0.format ?? "9:16",
      cutSilence: body.cutSilence ?? req0.cutSilence ?? true,
      cutFillers: body.cutFillers ?? req0.cutFillers ?? true,
      zooms: body.zooms ?? req0.zooms ?? true,
      reframe: body.reframe ?? req0.reframe ?? "face",
      broll: body.broll ?? 0,
      brollStyle: body.brollStyle ?? req0.brollStyle,
      logo: await brandLogo(body.logo ?? (req0.logo === false ? false : undefined)),
    };
    const title = body.title ?? req0.title;
    const job = await createJob({
      kind: "cut",
      provider: "ffmpeg",
      request: { kind: "cut", parentJobId: parentId, sourceUrl: videoUrl, index: req0.index ?? 0, start: body.start, end: body.end, title, hook: req0.hook, reason: req0.reason, score: req0.score, adjusted: true, replaces: isChild ? parent.id : undefined, ...options },
      estimated_cost_usd: 0,
    });
    await editQueue.add("cut", { jobId: job.id, task: "cut", videoUrl, transcriptUrl, start: body.start, end: body.end, title, options }, { jobId: job.id });
    return reply.code(202).send({ jobId: job.id, status: job.status, estimatedCostUsd: 0 });
  });

  /** dublagem grátis: Whisper → Seed 2.1 traduz no tempo → Seed Audio fala com a voz do próprio vídeo → FFmpeg troca o áudio (+ legenda traduzida) */
  app.post("/dub", async (req, reply) => {
    const body = z
      .object({
        videoUrl: videoRef,
        transcriptUrl: z.string().optional(),
        language: z.enum(["pt-BR", "en", "es", "it", "fr", "de", "ja"]).default("en"),
        voice: z.string().optional().describe("same (voz do vídeo, padrão) · default · id de voz cadastrada"),
        captions: z.boolean().optional(),
        format: formatSchema.optional(),
        context: z.string().max(600).optional(),
        bedVolume: z.number().min(0).max(0.5).optional(),
        consent: z.boolean().optional(),
      })
      .parse(req.body);
    if ((body.voice ?? "same") === "same" && !body.consent) return reply.code(400).send({ error: "clonar a voz de quem fala no vídeo precisa da autorização dessa pessoa — marque consent:true" });
    const transcriptUrl = body.transcriptUrl ?? (await existingTranscript(body.videoUrl));
    const options = { language: body.language, voice: body.voice ?? "same", captions: body.captions ?? true, format: body.format ?? "original", context: body.context, bedVolume: body.bedVolume ?? 0 };
    const job = await createJob({ kind: "dub", provider: "seedaudio", request: { kind: "dub", videoUrl: body.videoUrl, transcriptUrl, ...options, consent: !!body.consent }, estimated_cost_usd: 0 });
    await editQueue.add("dub", { jobId: job.id, task: "dub", videoUrl: body.videoUrl, transcriptUrl, options }, { jobId: job.id });
    return reply.code(202).send({ jobId: job.id, status: job.status, estimatedCostUsd: 0, reusedTranscript: !!transcriptUrl, note: "usa a cota grátis de voz (Seed Audio): ~1 min de voz por minuto de fala" });
  });

  /** vídeo de referência (que performou) → análise da estrutura → roteiro novo com o seu tema → projeto Quadrinhos */
  app.post("/script/from-video", async (req, reply) => {
    const body = z
      .object({
        videoUrl: videoRef,
        transcriptUrl: z.string().optional(),
        theme: z.string().min(3).max(600),
        style: z.string().optional(),
        scenes: z.number().int().min(1).max(20).optional(),
        projectId: z.string().uuid().optional(),
        voiceId: z.string().uuid().nullable().optional(),
        audience: z.string().optional(),
        tone: z.string().optional(),
        context: z.string().max(600).optional(),
      })
      .parse(req.body);
    const transcriptUrl = body.transcriptUrl ?? (await existingTranscript(body.videoUrl));
    const job = await createJob({ kind: "recreate", provider: "seed-2.1", request: { kind: "recreate", ...body, transcriptUrl }, estimated_cost_usd: 0.01, project_id: body.projectId ?? null });
    await editQueue.add("recreate", { jobId: job.id, task: "recreate", videoUrl: body.videoUrl, transcriptUrl, theme: body.theme, style: body.style, scenes: body.scenes, projectId: body.projectId, audience: body.audience, tone: body.tone, context: body.context, voiceId: body.voiceId }, { jobId: job.id });
    return reply.code(202).send({ jobId: job.id, status: job.status, estimatedCostUsd: 0.01, reusedTranscript: !!transcriptUrl });
  });

  /** texto do post (legenda + hashtags + título) a partir do que o vídeo diz — Seed 2.1, cota grátis, ~10 s */
  app.post("/copy", async (req, reply) => {
    const body = z.object({ jobId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), text: z.string().max(20_000).optional(), platform: z.enum(["instagram", "youtube", "tiktok", "ads"]).optional(), context: z.string().max(600).optional(), language: z.string().optional() }).parse(req.body);
    let text = body.text ?? "";
    let hint = "";
    if (!text && body.jobId) {
      const job = await getJob(body.jobId);
      if (!job) return reply.code(404).send({ error: "job não encontrado" });
      const r = (job.request ?? {}) as any;
      const u = (job.usage ?? {}) as any;
      if (job.kind === "cut") {
        const parent = r.parentJobId ? await getJob(r.parentJobId) : null;
        const url = transcriptUrlOf(parent) ?? (await existingTranscript(r.sourceUrl));
        if (url) {
          const t = await loadTranscript(url);
          text = wordsBetween(t, r.start ?? 0, r.end ?? t.durationSec).map((w) => w.text).join(" ");
        }
        hint = [r.title && `gancho do corte: ${r.title}`, r.hook && `frase forte: ${r.hook}`].filter(Boolean).join("; ");
      } else if (job.kind === "dub") {
        text = u.translation ?? "";
      } else if (job.kind === "render" && job.project_id) {
        const p = await getProject(job.project_id);
        if (p) {
          text = p.scenes.map((s) => (s.type === "card" ? `${s.card?.text ?? ""} ${s.card?.subtext ?? ""}` : s.script ?? "")).join("\n");
          hint = `título: ${p.title}; tema: ${p.theme ?? ""}`;
        }
      } else {
        const url = transcriptUrlOf(job);
        if (url) text = (await loadTranscript(url)).text;
      }
    } else if (!text && body.projectId) {
      const p = await getProject(body.projectId);
      if (!p) return reply.code(404).send({ error: "projeto não encontrado" });
      text = p.scenes.map((s) => (s.type === "card" ? `${s.card?.text ?? ""} ${s.card?.subtext ?? ""}` : s.script ?? "")).join("\n");
      hint = `título: ${p.title}; tema: ${p.theme ?? ""}`;
    }
    if (!text.trim()) return reply.code(400).send({ error: "sem texto: o vídeo não tem transcrição ainda (gere a legenda ou transcreva antes)" });
    const copy = await writeCopy(text, { platform: body.platform ?? "instagram", context: [hint, body.context].filter(Boolean).join(". "), language: body.language });
    return { copy, chars: text.length };
  });

  /** nota de viralidade: de um projeto (roteiro) ou de uma transcrição/texto — síncrono, ~15 s, cota grátis de texto */
  app.post("/review", async (req, reply) => {
    const body = z.object({ projectId: z.string().uuid().optional(), transcriptUrl: z.string().optional(), text: z.string().max(40_000).optional(), context: z.string().max(600).optional() }).parse(req.body);
    if (body.projectId) {
      const p = await getProject(body.projectId);
      if (!p) return reply.code(404).send({ error: "projeto não encontrado" });
      const text = p.scenes.map((s, i) => (s.type === "card" ? `[card ${i + 1}] ${s.card?.text ?? ""} ${s.card?.subtext ?? ""} ${s.card?.button ? `(botão: ${s.card.button})` : ""}` : `[cena ${i + 1}] ${s.script ?? ""}`)).join("\n");
      const review = await reviewVirality({ kind: "script", text: `Título: ${p.title}\nTema: ${p.theme ?? ""}\n${text}`, context: body.context });
      await updateProject(p.id, { review });
      return { projectId: p.id, review };
    }
    if (body.transcriptUrl) {
      const t = await loadTranscript(body.transcriptUrl);
      return { review: await reviewVirality({ kind: "transcript", text: t.text, durationSec: t.durationSec, context: body.context }) };
    }
    if (body.text) return { review: await reviewVirality({ kind: "script", text: body.text, context: body.context }) };
    return reply.code(400).send({ error: "informe projectId, transcriptUrl ou text" });
  });

  /** trabalhos de edição (pais): transcrições, legendas e lotes de cortes, mais recentes primeiro */
  app.get("/edit/jobs", async () => {
    const rows = await sql<JobRow[]>`select * from jobs where kind in ('transcribe','caption','cuts','recreate','dub','carousel') order by created_at desc limit 60`;
    return { jobs: rows };
  });
}
