-- Patch 20: allow storing participant platform per tour

alter table public.participants
  add column if not exists platform_name text;
