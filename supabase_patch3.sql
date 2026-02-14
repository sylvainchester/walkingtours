-- Patch: invite flow for sharing calendars

create table if not exists public.guide_share_invites (
  id uuid primary key default gen_random_uuid(),
  from_guide_id uuid not null references auth.users(id) on delete cascade,
  to_guide_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (from_guide_id, to_guide_id)
);

create index if not exists guide_share_invites_from_idx on public.guide_share_invites (from_guide_id);
create index if not exists guide_share_invites_to_idx on public.guide_share_invites (to_guide_id);

alter table public.guide_share_invites enable row level security;

create policy "guide_share_invites_select_related" on public.guide_share_invites
  for select using (from_guide_id = auth.uid() or to_guide_id = auth.uid());

create policy "guide_share_invites_insert_own" on public.guide_share_invites
  for insert with check (from_guide_id = auth.uid());

create policy "guide_share_invites_update_own" on public.guide_share_invites
  for update using (to_guide_id = auth.uid() or from_guide_id = auth.uid());
