-- Vozes salvas (referência de áudio para clonagem). Só com consentimento registrado.
create table if not exists voices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  reference_key text not null,          -- storage key do áudio de referência (<=30s)
  reference_url text not null,
  consent_name text,                    -- nome de quem autorizou
  consent_at timestamptz,               -- quando autorizou
  consent_note text,
  created_at timestamptz not null default now()
);

alter table projects add column if not exists voice_id uuid references voices(id) on delete set null;
alter table scenes add column if not exists audio_job_id uuid references jobs(id) on delete set null;

-- Uploads genéricos (referências de imagem/vídeo/áudio) — biblioteca
create table if not exists uploads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('image','video','audio')),
  name text not null,
  storage_key text not null,
  url text not null,
  bytes bigint,
  duration_sec numeric(8,2),
  created_at timestamptz not null default now()
);
