-- Patch: guide availability

create table if not exists public.guide_availability (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  available boolean not null default false,
  created_at timestamptz not null default now(),
  unique (guide_id, date)
);

create index if not exists guide_availability_guide_date_idx on public.guide_availability (guide_id, date);

alter table public.guide_availability enable row level security;

create policy "guide_availability_select_shared" on public.guide_availability
  for select using (
    guide_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.guide_shares gs
      WHERE (gs.guide_id = auth.uid() AND gs.shared_with_id = guide_id)
         OR (gs.shared_with_id = auth.uid() AND gs.guide_id = guide_id)
    )
  );

create policy "guide_availability_insert_own" on public.guide_availability
  for insert with check (guide_id = auth.uid());

create policy "guide_availability_update_own" on public.guide_availability
  for update using (guide_id = auth.uid());

create policy "guide_availability_delete_own" on public.guide_availability
  for delete using (guide_id = auth.uid());
