-- edição de vídeo gravado: transcrição (Whisper local), legenda queimada, cortes virais (pai + cada clipe)
alter table jobs drop constraint if exists jobs_kind_check;
alter table jobs add constraint jobs_kind_check check (kind in ('image','video','audio','render','avatar','upscale','lipsync','sfx','transcribe','caption','cuts','cut'));
