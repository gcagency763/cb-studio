create extension if not exists pgcrypto;

-- Projetos (um vídeo final = um projeto)
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null check (kind in ('comic','viral','cuts','clone','cinematic','ugc')),
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cenas do storyboard (quadrinho): texto → imagem → vídeo
create table if not exists scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  position int not null,
  script text not null,            -- narração / legenda da cena
  image_prompt text,               -- prompt da imagem
  motion_prompt text,              -- prompt da animação
  image_job_id uuid,
  video_job_id uuid,
  duration_sec int default 5,
  created_at timestamptz not null default now()
);
create index if not exists scenes_project_idx on scenes(project_id, position);

-- Jobs de geração (qualquer provedor)
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  kind text not null check (kind in ('image','video','audio')),
  provider text not null,
  provider_job_id text,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  request jsonb not null,
  output_url text,
  storage_key text,
  estimated_cost_usd numeric(10,4) not null default 0,
  usage jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_status_idx on jobs(status);
create index if not exists jobs_project_idx on jobs(project_id);

-- Assets persistidos (imagens, vídeos, áudios, renders finais)
create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  kind text not null,
  storage_key text not null,
  url text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

-- Livro-razão de créditos (só debita quando o usuário aprova o resultado)
create table if not exists credit_ledger (
  id bigserial primary key,
  project_id uuid references projects(id),
  job_id uuid references jobs(id),
  delta_usd numeric(10,4) not null,
  reason text not null,
  created_at timestamptz not null default now()
);
