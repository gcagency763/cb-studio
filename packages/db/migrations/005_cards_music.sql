-- Cenas podem ser cards de texto (sem imagem/vídeo)
alter table scenes add column if not exists type text not null default 'video' check (type in ('video','card'));
alter table scenes add column if not exists card jsonb;   -- { text, subtext, button, bgUrl }

-- Projeto: estilo de legenda e música
alter table projects add column if not exists caption_style text not null default 'karaoke';
alter table projects add column if not exists caption_uppercase boolean not null default true;
alter table projects add column if not exists music_url text;
alter table projects add column if not exists music_volume numeric(4,2) default 0.18;
alter table projects add column if not exists video_model text;  -- override do modelo de vídeo (ex. kling)
