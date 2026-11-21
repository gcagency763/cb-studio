-- configurações guardadas pelo app (ex.: tokens OAuth do YouTube) — nunca commitadas
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
