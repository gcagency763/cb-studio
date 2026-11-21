import { readFile } from "node:fs/promises";
import { deleteSetting, getSetting, setSetting } from "./db.js";
import { localFile } from "./render.js";

/**
 * YouTube Shorts: OAuth do próprio canal (sem app review — modo "teste" do Google Cloud basta pro dono)
 * e upload resumível. Precisa de YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET no .env; o token fica na tabela settings.
 */
const SCOPE = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl";
const KEY = "youtube.tokens";
type Tokens = { refresh_token: string; access_token?: string; expires_at?: number; channel?: { id: string; title: string } };

export function youtubeEnv() {
  return { configured: !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET) };
}
export const redirectUri = () => `${(process.env.PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "")}/v1/publish/youtube/callback`;

export function authUrl() {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", process.env.YOUTUBE_CLIENT_ID ?? "");
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  return u.toString();
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.YOUTUBE_CLIENT_ID ?? "", client_secret: process.env.YOUTUBE_CLIENT_SECRET ?? "", ...params }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google OAuth ${res.status}: ${json.error_description ?? json.error ?? res.statusText}`);
  return json as { access_token: string; refresh_token?: string; expires_in: number };
}

export async function exchangeCode(code: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  if (!t.refresh_token) throw new Error("Google não devolveu refresh_token — remova o acesso do app em myaccount.google.com/permissions e conecte de novo");
  const tokens: Tokens = { refresh_token: t.refresh_token, access_token: t.access_token, expires_at: Date.now() + (t.expires_in - 60) * 1000 };
  // canal
  const ch = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${t.access_token}` } }).then((r) => r.json() as any).catch(() => null);
  const item = ch?.items?.[0];
  if (item) tokens.channel = { id: item.id, title: item.snippet?.title ?? "" };
  await setSetting(KEY, tokens);
  return tokens;
}

export async function youtubeStatus() {
  const t = await getSetting<Tokens>(KEY);
  return { configured: youtubeEnv().configured, connected: !!t?.refresh_token, channel: t?.channel ?? null };
}

export async function disconnect() {
  await deleteSetting(KEY);
}

async function accessToken(): Promise<string> {
  const t = await getSetting<Tokens>(KEY);
  if (!t?.refresh_token) throw new Error("YouTube não conectado — Provedores → Publicar → Conectar YouTube");
  if (t.access_token && t.expires_at && Date.now() < t.expires_at) return t.access_token;
  const n = await tokenRequest({ refresh_token: t.refresh_token, grant_type: "refresh_token" });
  await setSetting(KEY, { ...t, access_token: n.access_token, expires_at: Date.now() + (n.expires_in - 60) * 1000 });
  return n.access_token;
}

async function bytesOf(videoRef: string): Promise<Uint8Array> {
  if (/^https?:/.test(videoRef)) {
    const r = await fetch(videoRef);
    if (!r.ok) throw new Error(`download ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  return new Uint8Array(await readFile(await localFile(videoRef)));
}

/** legenda (.srt) anexada ao vídeo — o YouTube mostra como CC e indexa o texto */
export async function uploadCaption(videoId: string, srt: string, language: string, name = "Legenda") {
  const token = await accessToken();
  const meta = { snippet: { videoId, language, name, isDraft: false } };
  const boundary = `g2-${Date.now()}`;
  const body = [`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`, `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n${srt}\r\n--${boundary}--`].join("");
  const res = await fetch("https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet", { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` }, body });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`YouTube captions ${res.status}: ${json.error?.message ?? "falhou"}`);
  return { captionId: json.id as string };
}

/** upload resumível; vídeo vertical curto com #Shorts vira Short sozinho */
export async function uploadVideo(input: { videoUrl: string; title: string; description?: string; tags?: string[]; privacy?: "public" | "unlisted" | "private"; shorts?: boolean }, onProgress?: (s: string) => void) {
  const token = await accessToken();
  const title = input.shorts !== false && !/#shorts/i.test(input.title) ? `${input.title} #Shorts`.slice(0, 100) : input.title.slice(0, 100);
  const meta = { snippet: { title, description: input.description ?? "", tags: input.tags ?? [], categoryId: "27" }, status: { privacyStatus: input.privacy ?? "public", selfDeclaredMadeForKids: false } };
  onProgress?.("iniciando upload");
  const bytes = await bytesOf(input.videoUrl);
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(bytes.byteLength), "X-Upload-Content-Type": "video/mp4" },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw new Error(`YouTube ${init.status}: ${(await init.text()).slice(0, 300)}`);
  const location = init.headers.get("location");
  if (!location) throw new Error("YouTube não devolveu a URL de upload");
  onProgress?.("enviando vídeo");
  const up = await fetch(location, { method: "PUT", headers: { "content-type": "video/mp4", "content-length": String(bytes.byteLength) }, body: new Blob([bytes as BlobPart]) });
  const json: any = await up.json().catch(() => ({}));
  if (!up.ok) throw new Error(`YouTube upload ${up.status}: ${json.error?.message ?? "falhou"}`);
  return { videoId: json.id as string, url: `https://youtube.com/shorts/${json.id}`, title };
}
