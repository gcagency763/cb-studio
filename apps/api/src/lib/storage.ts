import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { env } from "./env.js";

/**
 * Storage: o disco (STORAGE_DIR) é sempre onde o FFmpeg trabalha.
 * Com S3_ENDPOINT + S3_BUCKET (Cloudflare R2, bucket da Railway ou qualquer S3), todo arquivo salvo
 * também sobe pro bucket, e o disco vira só cache: se o arquivo não está no disco, baixa do bucket na hora.
 * Assim a máquina na nuvem pode ter disco pequeno e nada se perde quando ela reinicia.
 * URLs dos provedores expiram em horas — SEMPRE persistimos o arquivo.
 */

type S3 = import("@aws-sdk/client-s3").S3Client;
let client: Promise<S3> | null = null;

export const s3On = () => !!(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);

async function s3(): Promise<S3> {
  client ??= import("@aws-sdk/client-s3").then(
    ({ S3Client }) =>
      new S3Client({
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION ?? "auto",
        forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
        credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
      }),
  );
  return client;
}

/** chave relativa a partir de "/storage/x", "http://host/storage/x" ou "x" (recusa ".." pra não sair da pasta) */
export function keyOf(ref: string): string {
  const rel = ref.replace(/^https?:\/\/[^/]+/, "").replace(/^\/storage\//, "").replace(/^\/+/, "").split("?")[0];
  if (!rel || rel.includes("..")) throw new Error(`referência inválida: ${ref}`);
  return decodeURIComponent(rel);
}

export const diskPath = (key: string) => normalize(join(env.STORAGE_DIR, key));

/** sobe um arquivo que já está no disco pro bucket (no-op sem bucket) */
export async function mirrorToBucket(key: string, contentType?: string) {
  if (!s3On()) return;
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const path = diskPath(key);
  const { size } = await stat(path);
  await (await s3()).send(
    new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: createReadStream(path), ContentLength: size, ContentType: contentType ?? mimeFor(key) }),
  );
}

const inflight = new Map<string, Promise<boolean>>();

/** garante o arquivo no disco: se só existe no bucket, baixa (uma vez, mesmo com vários pedidos juntos) */
export async function ensureLocal(key: string): Promise<boolean> {
  const path = diskPath(key);
  if (existsSync(path)) return true;
  if (!s3On()) return false;
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      try {
        const r = await (await s3()).send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
        const bytes = await r.Body!.transformToByteArray();
        await mkdir(dirname(path), { recursive: true });
        const tmp = `${path}.part-${process.pid}`;
        await writeFile(tmp, bytes);
        await (await import("node:fs/promises")).rename(tmp, path);
        return true;
      } catch (e: any) {
        if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return false;
        throw e;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
  }
  return p;
}

export async function putObject(key: string, bytes: Uint8Array, contentType: string): Promise<{ key: string; url: string }> {
  const path = diskPath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  await mirrorToBucket(key, contentType);
  return { key, url: `/storage/${key}` };
}

/**
 * com bucket ligado, o disco é cache: apaga os arquivos mais antigos (que já estão no bucket)
 * quando passa de STORAGE_CACHE_GB. Sem bucket não apaga nada — o disco é o único lugar.
 */
export async function trimCache(): Promise<{ removed: number; freedBytes: number }> {
  if (!s3On()) return { removed: 0, freedBytes: 0 };
  const limit = (env.STORAGE_CACHE_GB ?? 3) * 1024 ** 3;
  const files: { path: string; size: number; t: number }[] = [];
  const walk = async (dir: string) => {
    for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = join(dir, d.name);
      if (d.isDirectory()) await walk(p);
      else if (!d.name.includes(".part-")) {
        const s = await stat(p).catch(() => null);
        if (s) files.push({ path: p, size: s.size, t: Math.max(s.atimeMs, s.mtimeMs) });
      }
    }
  };
  await walk(env.STORAGE_DIR);
  let total = files.reduce((a, f) => a + f.size, 0);
  if (total <= limit) return { removed: 0, freedBytes: 0 };
  files.sort((a, b) => a.t - b.t);
  let removed = 0;
  let freed = 0;
  const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
  for (const f of files) {
    if (total <= limit * 0.8) break;
    if (Date.now() - f.t < 30 * 60_000) continue; // em uso agora
    const key = f.path.slice(env.STORAGE_DIR.length).replace(/^\/+/, "");
    // só apaga do disco o que confirmadamente está no bucket
    const there = await (await s3()).send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key })).then(() => true, () => false);
    if (!there) {
      await mirrorToBucket(key).catch(() => {});
      continue;
    }
    await rm(f.path, { force: true });
    total -= f.size;
    freed += f.size;
    removed++;
  }
  return { removed, freedBytes: freed };
}

const MIME: Record<string, string> = {
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", json: "application/json", srt: "application/x-subrip", vtt: "text/vtt", txt: "text/plain",
};
export const mimeFor = (key: string) => MIME[(key.split(".").pop() ?? "").toLowerCase()] ?? "application/octet-stream";

export function extFor(contentType: string) {
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("mpeg") || contentType.includes("mp3")) return "mp3";
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("quicktime")) return "mov";
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("x-m4a") || contentType === "audio/mp4") return "m4a";
  if (contentType.includes("json")) return "json";
  return "bin";
}
