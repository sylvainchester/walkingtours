-- Patch 23: shared batch invoices metadata

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  guide_ids uuid[] not null default '{}'::uuid[],
  platform_name text not null,
  period_start date not null,
  period_end date not null,
  invoice_no text not null,
  file_path text not null,
  total_participants integer not null default 0,
  total_amount numeric not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.invoices enable row level security;

drop policy if exists "invoices_select_shared" on public.invoices;
drop policy if exists "invoices_insert_shared" on public.invoices;

create policy "invoices_select_shared" on public.invoices
  for select
  using (
    created_by = auth.uid()
    or auth.uid() = any(guide_ids)
  );

create policy "invoices_insert_shared" on public.invoices
  for insert
  with check (
    created_by = auth.uid()
    and auth.uid() = any(guide_ids)
  );
