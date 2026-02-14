-- Tables
create table if not exists public.tours (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  type text not null check (type in ('Free tour', 'Guide Chester tour')),
  created_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tours(id) on delete cascade,
  name text not null,
  group_size int not null check (group_size > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.guide_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.guide_shares (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references auth.users(id) on delete cascade,
  shared_with_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (guide_id, shared_with_id)
);

create index if not exists tours_guide_date_idx on public.tours (guide_id, date);
create index if not exists participants_tour_idx on public.participants (tour_id);
create index if not exists guide_shares_guide_idx on public.guide_shares (guide_id);
create index if not exists guide_shares_shared_idx on public.guide_shares (shared_with_id);

-- RLS
alter table public.tours enable row level security;
alter table public.participants enable row level security;
alter table public.guide_profiles enable row level security;
alter table public.guide_shares enable row level security;

-- Tours: each guide sees and edits their own tours
create policy "tours_select_own" on public.tours
  for select using (guide_id = auth.uid());

create policy "tours_insert_own" on public.tours
  for insert with check (guide_id = auth.uid());

create policy "tours_update_own" on public.tours
  for update using (guide_id = auth.uid());

create policy "tours_delete_own" on public.tours
  for delete using (guide_id = auth.uid());

-- Participants: access via the guide's tours
create policy "participants_select_own" on public.participants
  for select using (
    exists (select 1 from public.tours t where t.id = participants.tour_id and t.guide_id = auth.uid())
  );

create policy "participants_insert_own" on public.participants
  for insert with check (
    exists (select 1 from public.tours t where t.id = participants.tour_id and t.guide_id = auth.uid())
  );

create policy "participants_update_own" on public.participants
  for update using (
    exists (select 1 from public.tours t where t.id = participants.tour_id and t.guide_id = auth.uid())
  );

create policy "participants_delete_own" on public.participants
  for delete using (
    exists (select 1 from public.tours t where t.id = participants.tour_id and t.guide_id = auth.uid())
  );

-- Guide profiles
create policy "guide_profiles_select_all_authed" on public.guide_profiles
  for select using (auth.uid() is not null);

create policy "guide_profiles_insert_own" on public.guide_profiles
  for insert with check (id = auth.uid());

create policy "guide_profiles_update_own" on public.guide_profiles
  for update using (id = auth.uid());

-- Guide shares
create policy "guide_shares_select_related" on public.guide_shares
  for select using (guide_id = auth.uid() or shared_with_id = auth.uid());

create policy "guide_shares_insert_own" on public.guide_shares
  for insert with check (guide_id = auth.uid());

create policy "guide_shares_delete_own" on public.guide_shares
  for delete using (guide_id = auth.uid() or shared_with_id = auth.uid());

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.guide_profiles (id, first_name, last_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
