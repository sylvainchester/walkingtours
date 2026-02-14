-- Patch: add sharing support + allow profile lookup by email

-- New table for sharing calendars
create table if not exists public.guide_shares (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references auth.users(id) on delete cascade,
  shared_with_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (guide_id, shared_with_id)
);

create index if not exists guide_shares_guide_idx on public.guide_shares (guide_id);
create index if not exists guide_shares_shared_idx on public.guide_shares (shared_with_id);

-- Enable RLS for the new table
alter table public.guide_shares enable row level security;

-- Policies for guide_shares
create policy "guide_shares_select_related" on public.guide_shares
  for select using (guide_id = auth.uid() or shared_with_id = auth.uid());

create policy "guide_shares_insert_own" on public.guide_shares
  for insert with check (guide_id = auth.uid());

create policy "guide_shares_delete_own" on public.guide_shares
  for delete using (guide_id = auth.uid() or shared_with_id = auth.uid());

-- Allow authenticated users to look up guide profiles by email
create policy "guide_profiles_select_all_authed" on public.guide_profiles
  for select using (auth.uid() is not null);
