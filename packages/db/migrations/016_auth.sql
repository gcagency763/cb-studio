-- equipe: login por pessoa (só vale com AUTH_REQUIRED=true — no Mac continua aberto como antes)
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  role text not null default 'editor' check (role in ('admin', 'editor')),
  password_hash text not null,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user_idx on sessions(user_id);
alter table jobs add column if not exists created_by uuid;
alter table projects add column if not exists created_by uuid;
create index if not exists jobs_created_by_idx on jobs(created_by);
