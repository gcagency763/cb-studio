import { readFile } from "node:fs/promises";
import { localFile } from "./render.js";

/**
 * Publicar: Instagram Reels (upload direto, sem precisar de URL pública) e vídeo na conta de anúncios do Meta.
 * Precisa de um token do Meta no .env — nada pago, só configuração:
 *   IG_USER_ID         id da conta profissional do Instagram
 *   META_ACCESS_TOKEN  token de longa duração (usuário de sistema) com instagram_business_content_publish (+ ads_management pro Meta Ads)
 *   META_AD_ACCOUNT_ID act_123… (só pro upload de criativo)
 */
const GRAPH = "https://graph.facebook.com/v21.0";
const RUPLOAD = "https://rupload.facebook.com/ig-api-upload/v21.0";

export function publishEnv() {
  return {
    instagram: !!(process.env.IG_USER_ID && process.env.META_ACCESS_TOKEN),
    metaAds: !!(process.env.META_AD_ACCOUNT_ID && process.env.META_ACCESS_TOKEN),
    igUserId: process.env.IG_USER_ID ?? null,
    adAccountId: process.env.META_AD_ACCOUNT_ID ?? null,
  };
}

async function graph<T = any>(path: string, init: RequestInit & { form?: Record<string, string> } = {}): Promise<T> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN ausente no .env");
  const url = new URL(`${GRAPH}/${path}`);
  let body: BodyInit | undefined = init.body as BodyInit | undefined;
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.form) {
    const fd = new URLSearchParams({ ...init.form, access_token: token });
    body = fd;
    headers["content-type"] = "application/x-www-form-urlencoded";
  } else url.searchParams.set("access_token", token);
  const res = await fetch(url, { ...init, body, headers });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`Meta ${res.status}: ${json.error?.message ?? res.statusText}`);
  return json as T;
}

async function bytesOf(videoRef: string): Promise<Uint8Array> {
  if (/^https?:/.test(videoRef)) {
    const r = await fetch(videoRef);
    if (!r.ok) throw new Error(`download ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  return new Uint8Array(await readFile(await localFile(videoRef)));
}

/** Reels: container (upload resumível) → envia os bytes → espera processar → publica */
export async function publishReel(input: { videoUrl: string; caption: string; shareToFeed?: boolean; coverUrl?: string }, onProgress?: (s: string) => void) {
  const igUserId = process.env.IG_USER_ID;
  if (!igUserId) throw new Error("IG_USER_ID ausente no .env");
  onProgress?.("criando container");
  const container = await graph<{ id: string; uri?: string }>(`${igUserId}/media`, {
    method: "POST",
    form: { media_type: "REELS", upload_type: "resumable", caption: input.caption, share_to_feed: String(input.shareToFeed ?? true), ...(input.coverUrl ? { cover_url: input.coverUrl } : {}) },
  });
  onProgress?.("enviando vídeo");
  const bytes = await bytesOf(input.videoUrl);
  const up = await fetch(`${RUPLOAD}/${container.id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${process.env.META_ACCESS_TOKEN}`, offset: "0", file_size: String(bytes.byteLength), "content-type": "application/octet-stream" },
    body: new Blob([bytes as BlobPart]),
  });
  const upJson: any = await up.json().catch(() => ({}));
  if (!up.ok || upJson.success === false) throw new Error(`upload Meta ${up.status}: ${upJson.debug_info?.message ?? upJson.message ?? "falhou"}`);
  // processamento (até ~5 min)
  for (let i = 0; i < 100; i++) {
    const st = await graph<{ status_code: string; status?: string }>(`${container.id}?fields=status_code,status`);
    onProgress?.(`processando (${st.status_code})`);
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new Error(`Instagram não processou o vídeo: ${st.status ?? st.status_code}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  onProgress?.("publicando");
  const pub = await graph<{ id: string }>(`${igUserId}/media_publish`, { method: "POST", form: { creation_id: container.id } });
  const media = await graph<{ permalink?: string }>(`${pub.id}?fields=permalink`).catch(() => ({ permalink: undefined }));
  return { mediaId: pub.id, permalink: media.permalink ?? null };
}

/** sobe o vídeo na conta de anúncios (vira um vídeo disponível no Gerenciador pra montar o criativo) */
export async function uploadAdVideo(input: { videoUrl: string; name: string }, onProgress?: (s: string) => void) {
  const act = process.env.META_AD_ACCOUNT_ID;
  if (!act) throw new Error("META_AD_ACCOUNT_ID ausente no .env");
  const token = process.env.META_ACCESS_TOKEN!;
  onProgress?.("enviando vídeo");
  const bytes = await bytesOf(input.videoUrl);
  const fd = new FormData();
  fd.append("access_token", token);
  fd.append("name", input.name);
  fd.append("source", new Blob([bytes as BlobPart], { type: "video/mp4" }), `${input.name.replace(/[^\w.-]+/g, "_")}.mp4`);
  const res = await fetch(`${GRAPH}/${act.startsWith("act_") ? act : `act_${act}`}/advideos`, { method: "POST", body: fd });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`Meta ${res.status}: ${json.error?.message ?? res.statusText}`);
  return { videoId: json.id as string };
}
