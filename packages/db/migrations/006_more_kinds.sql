-- novos tipos de job: avatar (clone de pessoa), upscale (estilo Magnific), lipsync, sfx (efeito sonoro)
alter table jobs drop constraint if exists jobs_kind_check;
alter table jobs add constraint jobs_kind_check check (kind in ('image','video','audio','render','avatar','upscale','lipsync','sfx'));
