-- Projetos: tema, estilo visual, render final
alter table projects add column if not exists theme text;
alter table projects add column if not exists style text default 'comic';
alter table projects add column if not exists character_sheet text;   -- descrição fixa do personagem (consistência entre cenas)
alter table projects add column if not exists render_job_id uuid references jobs(id) on delete set null;

-- Cenas: ligação com jobs
alter table scenes add column if not exists updated_at timestamptz not null default now();
alter table scenes drop constraint if exists scenes_image_job_fk;
alter table scenes add constraint scenes_image_job_fk foreign key (image_job_id) references jobs(id) on delete set null;
alter table scenes drop constraint if exists scenes_video_job_fk;
alter table scenes add constraint scenes_video_job_fk foreign key (video_job_id) references jobs(id) on delete set null;

-- Jobs: a que cena pertencem
alter table jobs add column if not exists scene_id uuid references scenes(id) on delete set null;
create index if not exists jobs_scene_idx on jobs(scene_id);
