import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createJob, getJob, updateJob } from "../lib/db.js";
import { publishEnv, publishReel, uploadAdVideo } from "../lib/publish.js";
import { authUrl, disconnect, exchangeCode, uploadCaption, uploadVideo, youtubeEnv, youtubeStatus } from "../lib/youtube.js";
import { exportTranscript, loadTranscript } from "../lib/edit.js";

/**
 * Publicar direto do estúdio (configuração, não custo):
 *   GET  /publish/status      o que está configurado
 *   POST /publish/instagram   { videoUrl, caption } → Reels
 *   POST /publish/meta-ads    { videoUrl, name }   → vídeo na conta de anúncios
 * Cada publicação vira um job kind 'publish' (histórico em Gastos/Biblioteca).
 */
export async function publishRoutes(app: FastifyInstance) {
  app.get("/publish/status", async () => ({ ...publishEnv(), youtube: await youtubeStatus() }));

  // ── YouTube: OAuth do canal (uma vez) + upload ──
  app.get("/publish/youtube/auth", async (_req, reply) => {
    if (!youtubeEnv().configured) return reply.code(400).send({ error: "YouTube não configurado: YOUTUBE_CLIENT_ID e YOUTUBE_CLIENT_SECRET no .env (veja Provedores)" });
    return reply.redirect(authUrl());
  });
  app.get("/publish/youtube/callback", async (req, reply) => {
    const { code, error } = (req.query ?? {}) as { code?: string; error?: string };
    if (error || !code) return reply.type("text/html; charset=utf-8").send(`<p style="font-family:sans-serif">YouTube: ${error ?? "sem código"}. Feche esta aba e tente de novo.</p>`);
    try {
      const t = await exchangeCode(code);
      return reply.type("text/html; charset=utf-8").send(`<p style="font-family:sans-serif">✔ YouTube conectado${t.channel ? ` (${t.channel.title})` : ""}. Pode fechar esta aba e voltar pro CB Studio.</p>`);
    } catch (e: any) {
      return reply.type("text/html; charset=utf-8").send(`<p style="font-family:sans-serif">Falhou: ${e.message}</p>`);
    }
  });
  app.delete("/publish/youtube", async () => {
    await disconnect();
    return { ok: true };
  });
  app.post("/publish/youtube", async (req, reply) => {
    const body = z.object({ videoUrl: z.string().min(1), title: z.string().min(1).max(100), description: z.string().max(5000).optional(), tags: z.array(z.string()).max(30).optional(), privacy: z.enum(["public", "unlisted", "private"]).optional(), shorts: z.boolean().optional(), captionsJobId: z.string().uuid().optional().describe("job com transcrição (caption/cuts/dub/transcribe) → sobe a legenda .srt junto") }).parse(req.body);
    const st = await youtubeStatus();
    if (!st.connected) return reply.code(400).send({ error: st.configured ? "YouTube não conectado — Provedores → Publicar → Conectar YouTube" : "YouTube não configurado: YOUTUBE_CLIENT_ID e YOUTUBE_CLIENT_SECRET no .env" });
    const { captionsJobId, ...video } = body;
    const job = await createJob({ kind: "publish", provider: "youtube", request: { kind: "publish", target: "youtube", ...body }, estimated_cost_usd: 0 });
    try {
      await updateJob(job.id, { status: "running" });
      const r = await uploadVideo(video);
      let captions: { captionId: string } | { error: string } | null = null;
      if (captionsJobId) {
        try {
          const cj = await getJob(captionsJobId);
          const url = cj?.kind === "transcribe" ? cj.output_url : ((cj?.usage as any)?.transcriptUrl as string | undefined);
          if (url) {
            const t = await loadTranscript(url);
            captions = await uploadCaption(r.videoId, exportTranscript(t, "srt", { short: false }), (t.language || "pt").slice(0, 2) === "pt" ? "pt-BR" : t.language);
          }
        } catch (e: any) {
          captions = { error: e.message };
        }
      }
      await updateJob(job.id, { status: "succeeded", output_url: r.url, usage: { ...r, captions } });
      return { jobId: job.id, ...r, captions };
    } catch (e: any) {
      await updateJob(job.id, { status: "failed", error: e.message });
      return reply.code(502).send({ error: e.message, jobId: job.id });
    }
  });

  app.post("/publish/instagram", async (req, reply) => {
    const body = z.object({ videoUrl: z.string().min(1), caption: z.string().max(2200).default(""), shareToFeed: z.boolean().optional(), coverUrl: z.string().optional() }).parse(req.body);
    if (!publishEnv().instagram) return reply.code(400).send({ error: "Instagram não configurado: IG_USER_ID e META_ACCESS_TOKEN no .env (veja Provedores)" });
    const job = await createJob({ kind: "publish", provider: "instagram", request: { kind: "publish", target: "instagram", ...body }, estimated_cost_usd: 0 });
    try {
      await updateJob(job.id, { status: "running" });
      const r = await publishReel(body);
      await updateJob(job.id, { status: "succeeded", output_url: r.permalink, usage: r });
      return { jobId: job.id, ...r };
    } catch (e: any) {
      await updateJob(job.id, { status: "failed", error: e.message });
      return reply.code(502).send({ error: e.message, jobId: job.id });
    }
  });

  app.post("/publish/meta-ads", async (req, reply) => {
    const body = z.object({ videoUrl: z.string().min(1), name: z.string().min(1).max(120) }).parse(req.body);
    if (!publishEnv().metaAds) return reply.code(400).send({ error: "Meta Ads não configurado: META_AD_ACCOUNT_ID e META_ACCESS_TOKEN no .env (veja Provedores)" });
    const job = await createJob({ kind: "publish", provider: "meta-ads", request: { kind: "publish", target: "meta-ads", ...body }, estimated_cost_usd: 0 });
    try {
      await updateJob(job.id, { status: "running" });
      const r = await uploadAdVideo(body);
      await updateJob(job.id, { status: "succeeded", output_url: null, usage: r });
      return { jobId: job.id, ...r };
    } catch (e: any) {
      await updateJob(job.id, { status: "failed", error: e.message });
      return reply.code(502).send({ error: e.message, jobId: job.id });
    }
  });
}
