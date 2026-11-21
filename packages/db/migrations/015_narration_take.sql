-- narração do projeto numa tomada só (contínua): as cenas são cortadas em cima dela
alter table projects add column if not exists narration_job_id uuid;
