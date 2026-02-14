-- Patch: add bank details to guide_profiles

alter table public.guide_profiles add column if not exists sort_code text;
alter table public.guide_profiles add column if not exists account_number text;
alter table public.guide_profiles add column if not exists account_name text;
