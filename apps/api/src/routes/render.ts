import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createJob, updateProject } from "../lib/db.js";
import { renderQueue } from "../lib/queue.js";

const wordSchema = z.object({ start_time: z.number(), end_time: z.number(), text: z.string() });
const sceneSchema = z.object({
  videoUrl: z.string().min(1).optional(),
  extraVideoUrls: z.array(z.string().min(1)).max(8).optional(),
  trimSilence: z.boolean().optional(),
  audioSpan: z.object({ start: z.number().min(0), end: z.number().min(0) }).optional(),
  card: z.object({ text: z.string().min(1), subtext: z.string().optional(), button: z.string().optional(), bgUrl: z.string().optional(), bgColor: z.string().optional() }).optional(),
  caption: z.string().optional(),
  hideCaption: z.boolean().optional(),
  audioUrl: z.string().optional(),
  sentences: z.array(wordSchema.extend({ words: z.array(wordSchema).optional() })).optional(),
  durationSec: z.number().positive().optional(),
  tailSec: z.number().min(0).max(5).optional(),
}).refine((s) => s.videoUrl || s.card, { message: "cena precisa de videoUrl ou card" });

const bodySchema = z.object({
  projectId: z.string().uuid().optional(),
  scenes: z.array(sceneSchema).min(1).max(60),
  options: z
    .object({
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      fps: z.number().int().optional(),
      fontSize: z.number().int().optional(),
      fontName: z.string().optional(),
      marginBottom: z.number().int().optional(),
      padColor: z.string().optional(),
      captionStyle: z.enum(["karaoke", "sentence"]).optional(),
      captionMaxChars: z.number().int().min(0).max(200).optional(),
      narrationUrl: z.string().optional(),
      clipHeadSec: z.number().min(0).max(1).optional(),
      highlightColor: z.string().optional(),
      uppercase: z.boolean().optional(),
      musicUrl: z.string().optional(),
      musicVolume: z.number().min(0).max(1).optional(),
    })
    .default({}),
});

/** Render é local (FFmpeg) — custo zero, não passa pela guarda de custo. */
export async function renderRoutes(app: FastifyInstance) {
  app.post("/render", async (req, reply) => {
    const body = bodySchema.parse(req.body);
    const job = await createJob({
      kind: "render",
      provider: "ffmpeg",
      request: { scenes: body.scenes, options: body.options },
      estimated_cost_usd: 0,
      project_id: body.projectId ?? null,
    });
    if (body.projectId) await updateProject(body.projectId, { render_job_id: job.id });
    await renderQueue.add("render", { jobId: job.id, scenes: body.scenes, options: body.options }, { jobId: job.id });
    return reply.code(202).send({ jobId: job.id, status: job.status, estimatedCostUsd: 0 });
  });
}
