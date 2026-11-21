import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { campaignStatus, createCampaign, estimateCampaign, listCampaigns, produceCampaign, proposeHooks, renderCampaign } from "../lib/ads.js";
import { createJob } from "../lib/db.js";
import { GenError } from "../lib/generate.js";
import { editQueue } from "../lib/queue.js";

/**
 * Anúncios em escala: produto + ganchos → campanha com N quadrinhos, produzidos em lote.
 *   POST /ads/hooks          ganchos sugeridos (Seed 2.1)
 *   POST /ads                cria a campanha (N projetos) e enfileira os roteiros
 *   GET  /ads                campanhas
 *   GET  /ads/:id            status detalhado
 *   POST /ads/:id/estimate   { kind }
 *   POST /ads/:id/produce    { kind, allowPaid }
 *   POST /ads/:id/render
 */
export async function adsRoutes(app: FastifyInstance) {
  app.post("/ads/hooks", async (req) => {
    const body = z.object({ product: z.string().min(3).max(600), offer: z.string().max(300).optional(), audience: z.string().max(300).optional(), count: z.number().int().min(1).max(12).optional(), context: z.string().max(600).optional() }).parse(req.body);
    return { hooks: await proposeHooks(body) };
  });

  app.post("/ads", async (req, reply) => {
    const body = z
      .object({
        campaign: z.string().min(1).max(120),
        product: z.string().min(3).max(600),
        offer: z.string().max(300).optional(),
        audience: z.string().max(300).optional(),
        hooks: z.array(z.object({ angle: z.string().optional(), hook: z.string().min(3).max(200) })).min(1).max(12),
        style: z.string().optional(),
        voiceId: z.string().uuid().nullable().optional(),
        videoModel: z.string().nullable().optional(),
        scenes: z.number().int().min(3).max(14).optional(),
        tone: z.string().optional(),
      })
      .parse(req.body);
    const { campaignId, projects } = await createCampaign(body);
    const job = await createJob({ kind: "batch", provider: "seed-2.1", request: { kind: "batch", campaignId, campaign: body.campaign, hooks: body.hooks.length, scenes: body.scenes ?? 8, style: body.style ?? "epic" }, estimated_cost_usd: 0.005 * projects.length });
    await editQueue.add("batch", { jobId: job.id, task: "batch", campaignId, scenes: body.scenes, style: body.style, audience: body.audience, tone: body.tone }, { jobId: job.id });
    return reply.code(202).send({ campaignId, jobId: job.id, projects: projects.map((p) => ({ id: p.id, title: p.title, hook: p.hook })) });
  });

  app.get("/ads", async () => ({ campaigns: await listCampaigns() }));

  app.get("/ads/:id", async (req, reply) => {
    const st = await campaignStatus((req.params as { id: string }).id);
    if (!st.projects.length) return reply.code(404).send({ error: "campanha não encontrada" });
    return st;
  });

  app.post("/ads/:id/estimate", async (req) => {
    const body = z.object({ kind: z.enum(["image", "video", "audio"]) }).parse(req.body);
    return estimateCampaign((req.params as { id: string }).id, body.kind);
  });

  app.post("/ads/:id/produce", async (req, reply) => {
    const body = z.object({ kind: z.enum(["image", "video", "audio"]), allowPaid: z.boolean().default(false) }).parse(req.body);
    try {
      return reply.code(202).send(await produceCampaign((req.params as { id: string }).id, body.kind, body.allowPaid));
    } catch (e) {
      if (e instanceof GenError) return reply.code(e.status).send(e.body);
      throw e;
    }
  });

  app.post("/ads/:id/render", async (req, reply) => reply.code(202).send({ renders: await renderCampaign((req.params as { id: string }).id) }));
}
