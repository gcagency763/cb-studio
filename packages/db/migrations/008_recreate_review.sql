-- recriar vídeo de referência (job) e nota de viralidade guardada no projeto
alter table jobs drop constraint if exists jobs_kind_check;
alter table jobs add constraint jobs_kind_check check (kind in ('image','video','audio','render','avatar','upscale','lipsync','sfx','transcribe','caption','cuts','cut','recreate'));
alter table projects add column if not exists review jsonb;
alter table projects add column if not exists reference jsonb;
