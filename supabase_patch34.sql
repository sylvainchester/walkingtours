-- Patch 34: participant creation source

alter table public.participants
  add column if not exists creation_source text not null default 'manual';

alter table public.participants
  drop constraint if exists participants_creation_source_check;

alter table public.participants
  add constraint participants_creation_source_check
  check (creation_source in ('manual', 'email_import'));

update public.participants
set creation_source = 'manual'
where creation_source is null;
