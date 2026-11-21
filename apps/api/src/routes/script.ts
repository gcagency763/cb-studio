import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getProject, replaceScenes, updateProject } from "../lib/db.js";
import { STYLES, generateScript } from "../lib/script.js";

const bodySchema = z.object({
  projectId: z.string().uuid().optional(),
  theme: z.string().min(3).max(600),
  scenes: z.number().int().min(1).max(20).default(6),
  style: z.string().default("comic"),
  audience: z.string().optional(),
  tone: z.string().optional(),
  characterSheet: z.string().optional(),
});

export async function scriptRoutes(app: FastifyInstance) {
  app.get("/styles", async () => ({ styles: Object.entries(STYLES).map(([id, s]) => ({ id, label: s.label })) }));

  /**
   * Tema → roteiro. Custo: tokens de texto da ModelArk (Seed 2.1 turbo),
   * ~US$ 0,005 por roteiro, coberto pela cota grátis de 500K tokens.
   */
  app.post("/script", async (req, reply) => {
    const body = bodySchema.parse(req.body);
    const apiKey = process.env.ARK_API_KEY;
    if (!apiKey) return reply.code(400).send({ error: "ARK_API_KEY ausente" });

    const out = await generateScript(body, { apiKey, baseUrl: process.env.ARK_BASE_URL, model: process.env.ARK_TEXT_MODEL });

    if (body.projectId) {
      if (!(await getProject(body.projectId))) return reply.code(404).send({ error: "projeto não encontrado" });
      await updateProject(body.projectId, { title: out.title, theme: body.theme, style: body.style, character_sheet: out.character_sheet });
      await replaceScenes(
        body.projectId,
        out.scenes.map((s) => ({ ...s, card: s.card ?? null })),
      );
      return getProject(body.projectId);
    }
    return out;
  });
}
