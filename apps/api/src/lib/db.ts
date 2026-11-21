import postgres from "postgres";
import { env } from "./env.js";

export const sql = postgres(env.DATABASE_URL);

export type JobRow = {
  id: string;
  project_id: string | null;
  scene_id: string | null;
  kind: "image" | "video" | "audio" | "avatar" | "upscale" | "lipsync" | "sfx" | "render" | "transcribe" | "caption" | "cuts" | "cut" | "recreate" | "batch" | "publish" | "dub" | "carousel";
  provider: string;
  provider_job_id: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
  request: unknown;
  output_url: string | null;
  storage_key: string | null;
  estimated_cost_usd: number;
  usage: unknown;
  error: string | null;
  created_at: Date;
  updated_at: Date;
};

export type ProjectRow = {
  id: string;
  title: string;
  kind: string;
  status: string;
  theme: string | null;
  style: string | null;
  character_sheet: string | null;
  render_job_id: string | null;
  voice_id: string | null;
  caption_style: "karaoke" | "sentence";
  caption_uppercase: boolean;
  music_url: string | null;
  music_volume: number | null;
  video_model: string | null;
  /** direção da narração (ex.: "narrador de Reels, ritmo ágil") e ritmo (-50..100, 0 = normal) — valem pra todas as cenas */
  narration_style: string | null;
  speech_rate: number | null;
  /** narração contínua do projeto (uma tomada com o texto de todas as cenas) */
  narration_job_id: string | null;
  /** nota de viralidade (Seed 2.1) */
  review: unknown | null;
  /** análise do vídeo de referência que originou o roteiro */
  reference: unknown | null;
  /** anúncios em escala: campanha (grupo) e o gancho deste vídeo */
  campaign_id: string | null;
  campaign: string | null;
  hook: string | null;
  created_at: Date;
  updated_at: Date;
};

export type VoiceRow = {
  id: string;
  name: string;
  description: string | null;
  reference_key: string;
  reference_url: string;
  consent_name: string | null;
  consent_at: Date | null;
  consent_note: string | null;
  created_at: Date;
};

export type UploadRow = {
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  storage_key: string;
  url: string;
  bytes: number | null;
  duration_sec: number | null;
  created_at: Date;
};

export type SceneRow = {
  id: string;
  project_id: string;
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
  created_at: Date;
  updated_at: Date;
};

// ───────────────────────────── jobs ─────────────────────────────

/** id de quem está logado no pedido atual (lib/auth.ts guarda num AsyncLocalStorage global) */
function currentUserId(): string | null {
  const als = (globalThis as any).__g2CurrentUser as import("node:async_hooks").AsyncLocalStorage<{ id: string | null }> | undefined;
  return als?.getStore()?.id ?? null;
}

export async function createJob(
  j: Pick<JobRow, "kind" | "provider" | "request" | "estimated_cost_usd"> & { project_id?: string | null; scene_id?: string | null },
) {
  // quem pediu (login da equipe); sem login fica null
  const by = currentUserId();
  const [row] = await sql<JobRow[]>`
    insert into jobs (project_id, scene_id, kind, provider, request, estimated_cost_usd, created_by)
    values (${j.project_id ?? null}, ${j.scene_id ?? null}, ${j.kind}, ${j.provider}, ${sql.json(j.request as any)}, ${j.estimated_cost_usd}, ${by})
    returning *`;
  // liga o job à cena (imagem/vídeo/áudio)
  if (j.scene_id && (j.kind === "image" || j.kind === "video" || j.kind === "audio")) {
    const col = j.kind === "image" ? sql`image_job_id` : j.kind === "video" ? sql`video_job_id` : sql`audio_job_id`;
    await sql`update scenes set ${col} = ${row.id}, updated_at = now() where id = ${j.scene_id}`;
  }
  return row;
}

export async function updateJob(id: string, patch: Partial<JobRow>) {
  const [row] = await sql<JobRow[]>`
    update jobs set ${sql({ ...patch, updated_at: new Date() } as any)} where id = ${id} returning *`;
  return row;
}

export async function getJob(id: string) {
  const [row] = await sql<JobRow[]>`select * from jobs where id = ${id}`;
  return row ?? null;
}

// ───────────────────────────── projects ─────────────────────────────

export async function listProjects() {
  return sql<(ProjectRow & { scene_count: number; ready_count: number; cover_url: string | null; render_url: string | null })[]>`
    select p.*,
      (select count(*)::int from scenes s where s.project_id = p.id) as scene_count,
      (select count(*)::int from scenes s join jobs v on v.id = s.video_job_id where s.project_id = p.id and v.status = 'succeeded') as ready_count,
      (select j.output_url from scenes s join jobs j on j.id = s.image_job_id
         where s.project_id = p.id and j.status = 'succeeded' order by s.position limit 1) as cover_url,
      (select r.output_url from jobs r where r.id = p.render_job_id and r.status = 'succeeded') as render_url
    from projects p order by p.updated_at desc`;
}

export async function createProject(p: { title: string; kind?: string; theme?: string | null; style?: string | null; campaign_id?: string | null; campaign?: string | null; hook?: string | null; voice_id?: string | null; video_model?: string | null; status?: string }) {
  const [row] = await sql<ProjectRow[]>`
    insert into projects (title, kind, theme, style, campaign_id, campaign, hook, voice_id, video_model, status, created_by)
    values (${p.title}, ${p.kind ?? "comic"}, ${p.theme ?? null}, ${p.style ?? "comic"}, ${p.campaign_id ?? null}, ${p.campaign ?? null}, ${p.hook ?? null}, ${p.voice_id ?? null}, ${p.video_model ?? null}, ${p.status ?? "draft"}, ${currentUserId()}) returning *`;
  return row;
}

export async function getProject(id: string) {
  const [p] = await sql<ProjectRow[]>`select * from projects where id = ${id}`;
  if (!p) return null;
  const scenes = await sql<(SceneRow & { image_job: JobRow | null; video_job: JobRow | null; audio_job: JobRow | null })[]>`
    select s.*, row_to_json(i.*) as image_job, row_to_json(v.*) as video_job, row_to_json(a.*) as audio_job
    from scenes s
    left join jobs i on i.id = s.image_job_id
    left join jobs v on v.id = s.video_job_id
    left join jobs a on a.id = s.audio_job_id
    where s.project_id = ${id} order by s.position`;
  const render = p.render_job_id ? await getJob(p.render_job_id) : null;
  const narration = p.narration_job_id ? await getJob(p.narration_job_id) : null;
  const voice = p.voice_id ? await getVoice(p.voice_id) : null;
  return { ...p, scenes, render_job: render, narration_job: narration, voice };
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<ProjectRow, "title" | "theme" | "style" | "character_sheet" | "render_job_id" | "status" | "voice_id" | "caption_style" | "caption_uppercase" | "music_url" | "music_volume" | "video_model" | "narration_style" | "speech_rate" | "narration_job_id" | "review" | "reference" | "campaign_id" | "campaign" | "hook">>,
) {
  const p: any = { ...patch, updated_at: new Date() };
  // colunas jsonb precisam de sql.json
  for (const k of ["review", "reference"] as const) if (k in p && p[k] !== null && typeof p[k] === "object") p[k] = sql.json(p[k]);
  const [row] = await sql<ProjectRow[]>`update projects set ${sql(p)} where id = ${id} returning *`;
  return row ?? null;
}

export async function deleteProject(id: string) {
  await sql`delete from projects where id = ${id}`;
}

export type SceneInput = {
  id?: string;
  script: string;
  image_prompt?: string | null;
  motion_prompt?: string | null;
  duration_sec?: number | null;
  type?: "video" | "card";
  card?: SceneRow["card"];
};

/** Substitui a lista de cenas do projeto (mantém ids existentes; apaga as que sumiram). */
export async function replaceScenes(projectId: string, scenes: SceneInput[]) {
  return sql.begin(async (tx) => {
    const keep: string[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      if (s.id) {
        const [row] = await tx<SceneRow[]>`
          update scenes set position = ${i}, script = ${s.script}, image_prompt = ${s.image_prompt ?? null},
            motion_prompt = ${s.motion_prompt ?? null}, duration_sec = ${s.duration_sec ?? 5},
            type = ${s.type ?? "video"}, card = ${s.card ? tx.json(s.card as any) : null}, updated_at = now()
          where id = ${s.id} and project_id = ${projectId} returning *`;
        if (row) {
          keep.push(row.id);
          continue;
        }
      }
      const [row] = await tx<SceneRow[]>`
        insert into scenes (project_id, position, script, image_prompt, motion_prompt, duration_sec, type, card)
        values (${projectId}, ${i}, ${s.script}, ${s.image_prompt ?? null}, ${s.motion_prompt ?? null}, ${s.duration_sec ?? 5}, ${s.type ?? "video"}, ${s.card ? tx.json(s.card as any) : null}) returning *`;
      keep.push(row.id);
    }
    if (keep.length) await tx`delete from scenes where project_id = ${projectId} and id <> all(${keep}::uuid[])`;
    else await tx`delete from scenes where project_id = ${projectId}`;
    await tx`update projects set updated_at = now() where id = ${projectId}`;
    return keep;
  });
}

// ───────────────────────────── voices ─────────────────────────────

export async function listVoices() {
  return sql<VoiceRow[]>`select * from voices order by created_at desc`;
}
export async function getVoice(id: string) {
  const [v] = await sql<VoiceRow[]>`select * from voices where id = ${id}`;
  return v ?? null;
}
export async function createVoice(v: Omit<VoiceRow, "id" | "created_at">) {
  const [row] = await sql<VoiceRow[]>`insert into voices ${sql(v as any)} returning *`;
  return row;
}
export async function deleteVoice(id: string) {
  await sql`delete from voices where id = ${id}`;
}

// ───────────────────────────── uploads ─────────────────────────────

export async function listUploads(kind?: string) {
  return kind ? sql<UploadRow[]>`select * from uploads where kind = ${kind} order by created_at desc` : sql<UploadRow[]>`select * from uploads order by created_at desc`;
}
export async function createUpload(u: Omit<UploadRow, "id" | "created_at">) {
  const [row] = await sql<UploadRow[]>`insert into uploads ${sql(u as any)} returning *`;
  return row;
}

/** Galeria: todos os jobs concluídos com arquivo, por tipo. */
export async function listAssets(kind?: string, limit = 200) {
  // upscale aparece junto das imagens; "clone" = pessoas falando (avatar) + boca arrumada (lipsync); vídeo = só vídeo
  // "cuts" = clipes prontos (cortes + vídeos legendados); "transcribe" = transcrições
  const kinds = kind === "image" ? ["image", "upscale"] : kind === "video" ? ["video"] : kind === "clone" ? ["avatar", "lipsync"] : kind === "audio" ? ["audio", "sfx"] : kind === "cuts" ? ["cut", "caption", "dub"] : kind === "carousel" ? ["carousel"] : kind ? [kind] : [];
  return kind
    ? sql<JobRow[]>`select * from jobs where status = 'succeeded' and output_url is not null and kind = any(${kinds}) order by created_at desc limit ${limit}`
    : sql<JobRow[]>`select * from jobs where status = 'succeeded' and output_url is not null order by created_at desc limit ${limit}`;
}

/** minutos de áudio já gerados pelo Seed Speech (sucesso) — pra guarda da cota grátis */
export async function voiceMinutesUsed(): Promise<number> {
  const [row] = await sql<{ secs: string | null }[]>`
    select coalesce(sum((usage->>'seconds')::numeric), 0) as secs
    from jobs where kind in ('audio','dub','sfx') and provider = 'seedaudio' and status = 'succeeded'`;
  return Number(row?.secs ?? 0) / 60;
}

// ───────────────────────────── settings (chave/valor) ─────────────────────────────

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const [row] = await sql<{ value: T }[]>`select value from settings where key = ${key}`;
  return row?.value ?? null;
}
export async function setSetting(key: string, value: unknown) {
  await sql`insert into settings (key, value, updated_at) values (${key}, ${sql.json(value as any)}, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`;
}
export async function deleteSetting(key: string) {
  await sql`delete from settings where key = ${key}`;
}
