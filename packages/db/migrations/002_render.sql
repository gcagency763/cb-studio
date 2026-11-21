-- jobs.kind passa a aceitar 'render' (montagem final)
alter table jobs drop constraint if exists jobs_kind_check;
alter table jobs add constraint jobs_kind_check check (kind in ('image','video','audio','render'));
