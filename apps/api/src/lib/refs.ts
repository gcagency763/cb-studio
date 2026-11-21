import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { GenerationRequest } from "@g2/providers";
import { env } from "./env.js";
import { diskPath, ensureLocal } from "./storage.js";

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
};

/**
 * Referências de imagem podem vir como "/storage/..." (arquivo local).
 * Os provedores precisam de URL pública OU base64 — em dev não temos URL
 * pública, então embutimos o arquivo como data URL. Em produção, com R2,
 * basta trocar por S3_PUBLIC_BASE_URL + key.
 */
export async function resolveLocalRef(ref?: string): Promise<string | undefined> {
  if (!ref) return ref;
  if (/^(https?:|data:)/.test(ref)) return ref;

  const rel = ref.replace(/^https?:\/\/[^/]+/, "").replace(/^\/storage\//, "");
  if (!rel || rel.includes("..")) throw new Error(`referência inválida: ${ref}`);

  if (env.S3_PUBLIC_BASE_URL) return `${env.S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${rel}`;

  if (!(await ensureLocal(rel))) throw new Error(`arquivo não encontrado: ${ref}`);
  const path = diskPath(rel);
  const bytes = await readFile(path);
  const mime = MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

export async function resolveRequestRefs(req: GenerationRequest): Promise<GenerationRequest> {
  if (req.kind === "audio") {
    if (req.voiceRef?.audioUrl && !/^https?:/.test(req.voiceRef.audioUrl)) {
      // áudio local → base64 (Seed Audio aceita audio_data)
      const data = await resolveLocalRef(req.voiceRef.audioUrl);
      return { ...req, voiceRef: data?.startsWith("data:") ? { audioData: data } : { audioUrl: data } };
    }
    return req;
  }
  if (req.kind === "video") {
    return {
      ...req,
      firstFrame: await resolveLocalRef(req.firstFrame),
      lastFrame: await resolveLocalRef(req.lastFrame),
      audioRef: await resolveLocalRef(req.audioRef),
      referenceImages: req.referenceImages?.length ? await Promise.all(req.referenceImages.map((r) => resolveLocalRef(r) as Promise<string>)) : undefined,
    };
  }
  if (req.kind === "lipsync") {
    return { ...req, videoUrl: (await resolveLocalRef(req.videoUrl)) as string, audioUrl: (await resolveLocalRef(req.audioUrl)) as string };
  }
  if (req.kind === "sfx") return req;
  if (req.kind === "avatar") {
    return { ...req, imageUrl: (await resolveLocalRef(req.imageUrl)) as string, audioUrl: (await resolveLocalRef(req.audioUrl)) as string };
  }
  if (req.kind === "upscale") {
    return { ...req, imageUrl: (await resolveLocalRef(req.imageUrl)) as string };
  }
  if (req.referenceImages?.length) {
    return { ...req, referenceImages: await Promise.all(req.referenceImages.map((r) => resolveLocalRef(r) as Promise<string>)) };
  }
  return req;
}
