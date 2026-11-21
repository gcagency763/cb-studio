-- direção e ritmo da narração por projeto (a mesma pegada em todas as cenas e nos próximos episódios)
alter table projects add column if not exists narration_style text;
alter table projects add column if not exists speech_rate integer;
