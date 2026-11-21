import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createProject, deleteProject, getJob, getProject, listProjects, replaceScenes, sql, updateProject, type JobRow } from "../lib/db.js";
import { GenError, enqueue, guard, plan } from "../lib/generate.js";
import { checkTake } from "../lib/take.js";
import { estimateBatch, generateBatch, narrationTake, narrationText, requestFor, startNarration, startRender, startStill, status } from "../lib/pipeline.js";

const sceneSchema = z.object({
  id: z.string().uuid().optional(),
  script: z.string().default(""),
  image_prompt: z.string().nullable().optional(),
  motion_prompt: z.string().nullable().optional(),
  duration_sec: z.number().int().min(1).max(12).nullable().optional(),
  type: z.enum(["video", "card"]).optional(),
  card: z.object({ text: z.string().optional(), subtext: z.string().optional(), button: z.string().optional(), bgUrl: z.string().optional() }).nullable().optional(),
});

export async function projectRoutes(app: FastifyInstance) {
  app.get("/projects", async () => ({ projects: await listProjects() }));

  app.post("/projects", async (req, reply) => {
    const body = z
      .object({ title: z.string().min(1).max(120), kind: z.string().default("comic"), theme: z.string().optional(), style: z.string().optional() })
      .parse(req.body);
    const p = await createProject(body);
    return reply.code(201).send(p);
  });

  app.get("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await getProject(id);
    if (!p) return reply.code(404).send({ error: "projeto não encontrado" });
    return p;
  });

  app.patch("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        title: z.string().min(1).max(120).optional(),
        theme: z.string().nullable().optional(),
        style: z.string().nullable().optional(),
        character_sheet: z.string().nullable().optional(),
        status: z.string().optional(),
        voice_id: z.string().uuid().nullable().optional(),
        caption_style: z.enum(["karaoke", "sentence"]).optional(),
        caption_uppercase: z.boolean().optional(),
        music_url: z.string().nullable().optional(),
        music_volume: z.number().min(0).max(1).nullable().optional(),
        video_model: z.string().nullable().optional(),
        narration_style: z.string().max(300).nullable().optional(),
        speech_rate: z.number().int().min(-50).max(100).nullable().optional(),
        // escolher outra tomada de narração já gerada (ex.: a que passou na conferência)
        narration_job_id: z.string().uuid().nullable().optional(),
      })
      .parse(req.body);
    const p = await updateProject(id, body);
    if (!p) return reply.code(404).send({ error: "projeto não encontrado" });
    return p;
  });

  app.delete("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await deleteProject(id);
    return reply.code(204).send();
  });

  // ───────────── linha de produção (mesma lógica da mesa; usada pelo MCP) ─────────────

  /** o que está pronto e o que falta */
  app.get("/projects/:id/status", async (req, reply) => {
    const p = await getProject((req.params as { id: string }).id);
    if (!p) return reply.code(404).send({ error: "projeto não encontrado" });
    return status(p);
  });

  /** estima um lote (imagens, vídeos ou narrações das cenas pendentes) — não gasta nada */
  app.post("/projects/:id/estimate", async (req, reply) => {
    const body = z.object({ kind: z.enum(["image", "video", "audio"]), sceneIds: z.array(z.string().uuid()).optional(), mode: z.enum(["pending", "upgrade"]).optional() }).parse(req.body);
    const p = await getProject((req.params as { id: string }).id);
    if (!p) return reply.code(404).send({ error: "projeto não encontrado" });
    try {
      const e = estimateBatch(p, body.kind, body.sceneIds, body.mode ?? "pending");
      return { kind: body.kind, model: e.model, scenes: e.items.map((x) => ({ sceneId: x.scene.id, position: x.scene.position, estimatedCostUsd: x.cost, provider: x.provider.name })), totalUsd: e.totalUsd, paid: e.paid };
    } catch (e) {
      if (e instanceof GenError) return reply.code(e.status).send(e.body);
      throw e;
    }
  });

  /** gera o lote — tudo ou nada; lote pago exige allowPaid:true */
  app.post("/projects/:id/generate", async (req, reply) => {
    const body = z.object({ kind: z.enum(["image", "video", "audio"]), sceneIds: z.array(z.string().uuid()).optional(), allowPaid: z.boolean().default(false), mode: z.enum(["pending", "upgrade"]).optional() }).parse(req.body);
    const p = await getProject((req.params as { id: string }).id);
    if (!p) return reply.code(404).send({ error: "projeto não encontrado" });
    try {
      const r = await generateBatch(p, body.kind, { sceneIds: body.sceneIds, allowPaid: body.allowPaid, mode: body.mode });
      return reply.code(202).send(r);
    } catch (e) {
      if (e instanceof GenError) return reply.code(e.status).send(e.body);
      throw e;
    }
  });

  /** monta o vídeo final com o que estiver pronto (FFmpeg local, custo zero) */
  app.post("/projects/:id/render", async (req, reply) => {
    const p = await getProject((req.params as { id: string }).id);
    if (!p) return reply.code(404).send({ error: "projeto não encontrado" });
    try {
      return reply.code(202).send(await startRender(p));
    } catch (e) {
      if (e instanceof GenError) return reply.code(e.status).send(e.body);
      throw e;
    }
  });

  /** grade de variações: N imagens alternativas pra uma cena (não mexe na imagem atual até você escolher) */
  app.post("/projects/:id/scenes/:sceneId/variations", async (req, reply) => {
    const { id, sceneId } = req.params as { id: string; sceneId: string };
    const body = z.object({ count: z.number().int().min(1).max(9).default(4), allowPaid: z.boolean().default(false), model: z.string().optional() }).parse(req.body ?? {});
    const p = await getProject(id);
    const scene = p?.scenes.find((s) => s.id === sceneId);
    if (!p || !scene) return reply.code(404).send({ error: "cena não encontrada" });
    if (!(scene.image_prompt ?? "").trim()) return reply.code(400).send({ error: "cena sem prompt de imagem" });
    try {
      const base = requestFor(p, scene, "image");
      const queued = [];
      for (let i = 0; i < body.count; i++) {
        const request = { ...base, model: body.model ?? base.model, seed: Math.floor(Math.random() * 2_000_000_000), variationFor: sceneId };
        const { provider, cost } = plan(request);
        await guard(request, provider, cost, body.allowPaid);
        const job = await enqueue(request, provider.name, cost, { projectId: id, sceneId: null });
        queued.push({ jobId: job.id, estimatedCostUsd: cost });
      }
      return reply.code(202).send({ queued, totalUsd: queued.reduce((a, q) => a + q.estimatedCostUsd, 0) });
    } catch (e) {
      if (e instanceof GenError) return reply.code(e.status).send(e.body);
      throw e;
    }
  });

  app.get("/projects/:id/scenes/:sceneId/variations", async (req) => {
    const { id, sceneId } = req.params as { id: string; sceneId: string };
    const rows = await sql<JobRow[]>`select * from jobs where project_id = ${id} and kind = 'image' and request->>'variationFor' = ${sceneId} order by created_at desc limit 30`;
    return { variations: rows };
  });

  /** narração contínua: o texto de todas as cenas numa tomada só (sem emenda); o render corta as cenas em cima dela */
  app.post("/projects/:id/narration", async (req, reply) => {
    const p = await getProject((req.params as { id: string }).id);
    if (!p) return reply.code(404).send({ error: "projeto não encontrado" });
    const body = z.object({ allowPaid: z.boolean().default(false) }).parse(req.body ?? {});
    try {
      return reply.code(202).send(await startNarration(p, body));
    } catch (e) {
      if (e instanceof GenError) return reply.code(e.status).send(e.body);
      throw e;
    }
  });

  app.get("/projects/:id/narration", async (req, reply) => {
    const p = await getProject((req.params as { id: string }).id);
    if (!p) return reply.code(404).send({ error: "projeto não encontrado" });
    const j = (p as any).narration_job;
    // conferência da voz (tomadas antigas não têm: calcula na hora)
    const check = j?.usage?.check ?? (j?.usage?.subtitle?.sentences && j.request?.text ? checkTake(j.request.text, j.usage.subtitle.sentences) : null);
    return { job: j ? { id: j.id, status: j.status, url: j.output_url, error: j.error, seconds: j.usage?.seconds } : null, current: !!narrationTake(p as any), chars: narrationText(p).length, check };
  });

  /** plano parado: a imagem da cena vira o clipe (zoom de aproximação) no lugar do vídeo de IA — local, grátis */
  app.post("/projects/:id/scenes/:sceneId/still", async (req, reply) => {
    const { id, sceneId } = req.params as { id: string; sceneId: string };
    const body = z.object({ durationSec: z.number().min(1.5).max(15).optional(), zoom: z.number().min(1).max(1.6).optional(), focusX: z.number().min(0).max(1).optional(), focusY: z.number().min(0).max(1).optional() }).parse(req.body ?? {});
    const p = await getProject(id);
    const scene = p?.scenes.find((s) => s.id === sceneId);
    if (!p || !scene) return reply.code(404).send({ error: "cena não encontrada" });
    try {
      return reply.code(202).send(await startStill(p, scene, body));
    } catch (e) {
      if (e instanceof GenError) return reply.code(e.status).send(e.body);
      throw e;
    }
  });

  /** aponta a cena pra outra imagem/vídeo/narração já gerada (ex.: escolher uma variação) */
  app.patch("/projects/:id/scenes/:sceneId", async (req, reply) => {
    const { id, sceneId } = req.params as { id: string; sceneId: string };
    const body = z.object({ image_job_id: z.string().uuid().optional(), video_job_id: z.string().uuid().optional(), audio_job_id: z.string().uuid().optional() }).parse(req.body);
    const p = await getProject(id);
    if (!p || !p.scenes.some((s) => s.id === sceneId)) return reply.code(404).send({ error: "cena não encontrada" });
    for (const [col, jobId] of Object.entries(body) as [keyof typeof body, string][]) {
      const j = await getJob(jobId);
      if (!j || j.project_id !== id || j.status !== "succeeded") return reply.code(400).send({ error: `${col}: job inválido` });
      await sql`update scenes set ${sql(col)} = ${jobId}, updated_at = now() where id = ${sceneId}`;
    }
    return getProject(id);
  });

  /** Salva a lista inteira de cenas (ordem = posição). */
  app.put("/projects/:id/scenes", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ scenes: z.array(sceneSchema).max(60) }).parse(req.body);
    if (!(await getProject(id))) return reply.code(404).send({ error: "projeto não encontrado" });
    await replaceScenes(id, body.scenes);
    return getProject(id);
  });
}
