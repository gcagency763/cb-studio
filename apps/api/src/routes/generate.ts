import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { catalogWithAvailability } from "@g2/providers";
import { getJob } from "../lib/db.js";
import { env } from "../lib/env.js";
import { GenError, enqueue, guard, plan, providers } from "../lib/generate.js";

const imageSchema = z.object({
  kind: z.literal("image"),
  prompt: z.string().min(3),
  model: z.string().optional(),
  size: z.string().optional(),
  referenceImages: z.array(z.string().min(1)).optional(),
  seed: z.number().int().optional(),
});

const videoSchema = z.object({
  kind: z.literal("video"),
  prompt: z.string().min(3),
  model: z.string().optional(),
  // aceita URL pública OU caminho local "/storage/..." (worker converte em base64)
  firstFrame: z.string().min(1).optional(),
  lastFrame: z.string().min(1).optional(),
  ratio: z.enum(["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"]).optional(),
  resolution: z.enum(["480p", "720p", "1080p"]).optional(),
  durationSec: z.number().int().min(2).max(30).optional(),
  audio: z.boolean().optional(),
  audioRef: z.string().min(1).optional(),
  referenceImages: z.array(z.string().min(1)).max(30).optional(),
  seed: z.number().int().optional(),
});

const audioSchema = z.object({
  kind: z.literal("audio"),
  text: z.string().min(1).max(3000),
  voiceRef: z.object({ audioUrl: z.string().optional(), audioData: z.string().optional(), speaker: z.string().optional() }).optional(),
  style: z.string().max(300).optional(),
  speechRate: z.number().int().min(-50).max(100).optional(),
  pitch: z.number().int().min(-12).max(12).optional(),
  format: z.enum(["mp3", "wav"]).optional(),
  subtitles: z.boolean().optional(),
  language: z.string().optional(),
});

const avatarSchema = z.object({
  kind: z.literal("avatar"),
  model: z.string().optional(),
  imageUrl: z.string().min(1),
  audioUrl: z.string().min(1),
  prompt: z.string().max(500).optional(),
  resolution: z.enum(["720p", "1080p"]).optional(),
  audioSec: z.number().positive().optional(),
});

const upscaleSchema = z.object({
  kind: z.literal("upscale"),
  model: z.string().optional(),
  imageUrl: z.string().min(1),
  factor: z.number().min(1).max(4).optional(),
  creativity: z.number().min(0).max(1).optional(),
  resemblance: z.number().min(0).max(1).optional(),
  prompt: z.string().max(500).optional(),
  inputMp: z.number().positive().optional(),
});

const lipsyncSchema = z.object({
  kind: z.literal("lipsync"),
  model: z.string().optional(),
  videoUrl: z.string().min(1),
  audioUrl: z.string().min(1),
  pro: z.boolean().optional(),
  videoSec: z.number().positive().optional(),
});

const sfxSchema = z.object({
  kind: z.literal("sfx"),
  model: z.string().optional(),
  prompt: z.string().min(2).max(400),
  durationSec: z.number().min(0.5).max(120).optional(),
});

const bodySchema = z.object({
  /** vazio = escolhe pelo tipo (byteplus para imagem/vídeo, seedaudio para áudio) */
  provider: z.string().optional(),
  projectId: z.string().uuid().optional(),
  sceneId: z.string().uuid().optional(),
  /** precisa ser true para jobs acima de MAX_JOB_COST_USD */
  allowPaid: z.boolean().default(false),
  request: z.discriminatedUnion("kind", [imageSchema, videoSchema, audioSchema, avatarSchema, upscaleSchema, lipsyncSchema, sfxSchema]),
});

export async function generateRoutes(app: FastifyInstance) {
  /** catálogo de modelos com disponibilidade (o que está travado e por quê) */
  app.get("/models", async () => ({ models: catalogWithAvailability(process.env) }));

  app.get("/providers", async () => ({
    providers: Object.values(providers).map((p) => ({ name: p.name, image: p.supports("image"), video: p.supports("video"), audio: p.supports("audio") })),
    seedance2: process.env.ARK_ALLOW_SEEDANCE_2 === "true",
    maxJobCostUsd: env.MAX_JOB_COST_USD,
  }));

  /** Só estima — não gasta nada. Usado pela UI antes de confirmar. */
  app.post("/estimate", async (req, reply) => {
    const body = bodySchema.parse(req.body);
    try {
      const { provider, cost, paid } = plan(body.request, body.provider);
      return { estimatedCostUsd: cost, provider: provider.name, paid, maxJobCostUsd: env.MAX_JOB_COST_USD };
    } catch (e) {
      if (e instanceof GenError) return reply.code(e.status).send(e.body);
      throw e;
    }
  });

  app.post("/generate", async (req, reply) => {
    const body = bodySchema.parse(req.body);
    try {
      const { provider, cost } = plan(body.request, body.provider);
      await guard(body.request, provider, cost, body.allowPaid);
      const job = await enqueue(body.request, provider.name, cost, { projectId: body.projectId, sceneId: body.sceneId });
      return reply.code(202).send({ jobId: job.id, status: job.status, estimatedCostUsd: cost });
    } catch (e) {
      if (e instanceof GenError) return reply.code(e.status).send(e.body);
      throw e;
    }
  });

  app.get("/jobs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await getJob(id);
    if (!job) return reply.code(404).send({ error: "job não encontrado" });
    return job;
  });
}
