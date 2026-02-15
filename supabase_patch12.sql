-- Patch: payment type + fee per participant

alter table public.tour_types
  add column if not exists payment_type text not null default 'prepaid' check (payment_type in ('prepaid','free'));

alter table public.tour_types
  add column if not exists fee_per_participant numeric;
