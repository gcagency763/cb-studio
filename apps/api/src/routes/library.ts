import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createUpload, createVoice, deleteVoice, getVoice, listAssets, listUploads, listVoices } from "../lib/db.js";
import { env } from "../lib/env.js";
import { extFor, mirrorToBucket } from "../lib/storage.js";

const KIND_BY_MIME = (m: string): "image" | "video" | "audio" | null =>
  m.startsWith("image/") ? "image" : m.startsWith("video/") ? "video" : m.startsWith("audio/") ? "audio" : null;

export async function libraryRoutes(app: FastifyInstance) {
  /** Biblioteca: gerações concluídas + uploads, por tipo. */
  app.get("/library", async (req) => {
    const { kind } = (req.query ?? {}) as { kind?: string };
    const [generated, uploads] = await Promise.all([listAssets(kind), listUploads(kind)]);
    return { generated, uploads };
  });

  /** Upload de referência (imagem/vídeo/áudio) — vai para /storage/uploads. Vídeo longo (aula, live) pode ter GBs: grava em stream. */
  app.post("/uploads", async (req, reply) => {
    const file = await req.file({ limits: { fileSize: 8 * 1024 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: "envie um arquivo no campo 'file'" });
    const kind = KIND_BY_MIME(file.mimetype);
    if (!kind) return reply.code(415).send({ error: `tipo não suportado: ${file.mimetype}` });
    const safe = file.filename.replace(/[^\w.\-]+/g, "_").slice(0, 80);
    const ext = extFor(file.mimetype) === "bin" ? (file.filename.split(".").pop() ?? "bin").toLowerCase() : extFor(file.mimetype);
    const key = `uploads/${Date.now()}-${safe.toLowerCase().endsWith(`.${ext}`) ? safe : `${safe}.${ext}`}`;
    const path = join(env.STORAGE_DIR, key);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(file.file, createWriteStream(path));
    if (file.file.truncated) return reply.code(413).send({ error: "arquivo acima de 8 GB" });
    const { size } = await stat(path);
    await mirrorToBucket(key, file.mimetype);
    const row = await createUpload({ kind, name: file.filename, storage_key: key, url: `/storage/${key}`, bytes: size, duration_sec: null });
    return reply.code(201).send(row);
  });

  // ───────────── vozes (clonagem com consentimento) ─────────────

  app.get("/voices", async () => ({ voices: await listVoices() }));

  app.post("/voices", async (req, reply) => {
    const body = z
      .object({
        name: z.string().min(1).max(80),
        description: z.string().max(300).optional(),
        /** url de um upload de áudio (/storage/uploads/...) com até 30 s */
        referenceUrl: z.string().min(1),
        consentName: z.string().min(2).max(120),
        consentNote: z.string().max(500).optional(),
      })
      .parse(req.body);
    const v = await createVoice({
      name: body.name,
      description: body.description ?? null,
      reference_key: body.referenceUrl.replace(/^\/storage\//, ""),
      reference_url: body.referenceUrl,
      consent_name: body.consentName,
      consent_at: new Date(),
      consent_note: body.consentNote ?? null,
    });
    return reply.code(201).send(v);
  });

  app.get("/voices/:id", async (req, reply) => {
    const v = await getVoice((req.params as any).id);
    return v ?? reply.code(404).send({ error: "voz não encontrada" });
  });

  app.delete("/voices/:id", async (req, reply) => {
    await deleteVoice((req.params as any).id);
    return reply.code(204).send();
  });
}
