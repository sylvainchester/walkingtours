-- Patch: free tour settlement fields

alter table public.tours
  add column if not exists free_amount_received numeric,
  add column if not exists platform_due_amount numeric;
