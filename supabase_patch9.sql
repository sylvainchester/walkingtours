-- Patch: tour types configuration

create table if not exists public.tour_types (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  ticket_price numeric,
  commission_percent numeric,
  invoice_org_name text,
  invoice_org_address text,
  created_at timestamptz not null default now()
);

create index if not exists tour_types_guide_idx on public.tour_types (guide_id);

alter table public.tour_types enable row level security;

create policy "tour_types_select_shared" on public.tour_types
  for select using (
    guide_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.guide_shares gs
      WHERE (gs.guide_id = auth.uid() AND gs.shared_with_id = guide_id)
         OR (gs.shared_with_id = auth.uid() AND gs.guide_id = guide_id)
    )
  );

create policy "tour_types_insert_own" on public.tour_types
  for insert with check (guide_id = auth.uid());

create policy "tour_types_update_own" on public.tour_types
  for update using (guide_id = auth.uid());

create policy "tour_types_delete_own" on public.tour_types
  for delete using (guide_id = auth.uid());
