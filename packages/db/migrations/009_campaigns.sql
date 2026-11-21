-- anúncios em escala: vários quadrinhos (um por gancho) agrupados numa campanha
alter table projects add column if not exists campaign_id uuid;
alter table projects add column if not exists campaign text;
alter table projects add column if not exists hook text;
create index if not exists projects_campaign_idx on projects(campaign_id);
alter table jobs drop constraint if exists jobs_kind_check;
alter table jobs add constraint jobs_kind_check check (kind in ('image','video','audio','render','avatar','upscale','lipsync','sfx','transcribe','caption','cuts','cut','recreate','batch'));
