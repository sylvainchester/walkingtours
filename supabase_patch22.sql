-- Patch 22: store tour type schedule templates and generated schedule metadata

alter table public.tour_types
  add column if not exists schedule_templates jsonb not null default '[]'::jsonb,
  add column if not exists template_end_date date;

alter table public.tours
  add column if not exists source_tour_type_id uuid references public.tour_types(id) on delete set null,
  add column if not exists source_template_id text;
