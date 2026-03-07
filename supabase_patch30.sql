-- Patch 30: viewer color preferences for guide display

alter table public.guide_profiles
  add column if not exists color_mode text default 'auto';

alter table public.guide_profiles
  drop constraint if exists guide_profiles_color_mode_check;

alter table public.guide_profiles
  add constraint guide_profiles_color_mode_check
  check (color_mode in ('auto', 'custom'));

alter table public.guide_profiles
  add column if not exists guide_color_overrides jsonb default '{}'::jsonb;
