export type Job = {
  id: string;
  kind: "image" | "video" | "audio" | "render" | "avatar" | "upscale" | "lipsync" | "sfx" | "transcribe" | "caption" | "cuts" | "cut" | "recreate" | "batch" | "publish" | "dub" | "carousel";
  status: "queued" | "running" | "succeeded" | "failed";
  output_url: string | null;
  error: string | null;
  estimated_cost_usd: number | string;
  request?: any;
  usage?: any;
  created_at?: string;
};

export type Voice = {
  id: string;
  name: string;
  description: string | null;
  reference_url: string;
  consent_name: string | null;
  consent_at: string | null;
  created_at: string;
};

export type Upload = { id: string; kind: "image" | "video" | "audio"; name: string; url: string; bytes: number | null; created_at: string };

export type Scene = {
  id: string;
  position: number;
  script: string;
  image_prompt: string | null;
  motion_prompt: string | null;
  image_job_id: string | null;
  video_job_id: string | null;
  audio_job_id: string | null;
  duration_sec: number | null;
  type: "video" | "card";
  card: { text?: string; subtext?: string; button?: string; bgUrl?: string } | null;
  image_job: Job | null;
  video_job: Job | null;
  audio_job: Job | null;
};

export type Project = {
  id: string;
  title: string;
  kind: string;
  status: string;
  theme: string | null;
  style: string | null;
  character_sheet: string | null;
  render_job_id: string | null;
  voice_id: string | null;
  voice: Voice | null;
  caption_style: "karaoke" | "sentence";
  caption_uppercase: boolean;
  music_url: string | null;
  music_volume: number | null;
  video_model: string | null;
  narration_style?: string | null;
  speech_rate?: number | null;
  /** narração contínua (uma tomada com todas as falas) */
  narration_job_id?: string | null;
  narration_job?: Job | null;
  /** nota de viralidade (Seed 2.1) */
  review?: Review | null;
  /** análise do vídeo de referência que originou o roteiro */
  reference?: Record<string, any> | null;
  scenes: Scene[];
  render_job: Job | null;
  updated_at: string;
};

export type Review = {
  score: number;
  hook: { score: number; note: string };
  pacing: { score: number; note: string };
  clarity: { score: number; note: string };
  cta: { score: number; note: string };
  improvements: string[];
  bestVersion?: string;
};

export type ProjectSummary = {
  id: string;
  title: string;
  style: string | null;
  campaign?: string | null;
  hook?: string | null;
  status?: string;
  scene_count: number;
  ready_count: number;
  cover_url: string | null;
  render_url: string | null;
  updated_at: string;
};

export type Stats = {
  todayCostUsd: number;
  /** cobrado no cartão hoje */
  todayBilledUsd?: number;
  /** valor de tabela que saiu da cota grátis hoje */
  todayFreeUsd?: number;
  totalCostUsd: number;
  queued: number;
  running: number;
  images: number;
  videos: number;
  maxJobCostUsd: number;
  freeCreditsOnly: boolean;
  /** modo custo zero: nada que cobre no cartão roda */
  zeroCost?: boolean;
};

export class ApiError extends Error {
  constructor(message: string, public status: number, public body: any) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* texto */
  }
  // login ligado (nuvem) e sessão expirou → vai pra tela de entrar e volta pra cá depois
  if (r.status === 401 && body?.login && typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (!r.ok) throw new ApiError(body?.error ?? body?.message ?? r.statusText, r.status, body);
  return body as T;
}

export type Me = { authRequired: boolean; user: { id: string; email: string; name: string; role: "admin" | "editor" } | null };
export type TeamUser = { id: string; email: string; name: string; role: "admin" | "editor"; disabled: boolean; created_at: string; last_login_at: string | null; month_usd: number; month_jobs: number };

export const usd = (n: number | string | null | undefined) => `US$ ${(+(n ?? 0)).toFixed(n && +n < 0.1 ? 3 : 2)}`;

export const isActive = (j?: Job | null) => !!j && (j.status === "queued" || j.status === "running");
export const isDone = (j?: Job | null) => !!j && j.status === "succeeded" && !!j.output_url;

/** upload com progresso (vídeo de aula pode ter GBs) */
export function uploadFile(file: File, onProgress?: (pct: number) => void): Promise<Upload> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => reject(new ApiError("falha no envio", 0, null));
    xhr.onload = () => {
      let body: any = xhr.responseText;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* texto */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(body?.error ?? xhr.statusText, xhr.status, body));
    };
    xhr.send(fd);
  });
}

export const fmtDate = (s?: string) => (s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
