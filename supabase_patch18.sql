-- Patch 18: whitelist emails allowed to sign up
-- Run this in Supabase SQL editor.

create table if not exists public.signup_whitelist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  enabled boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  unique (email)
);

alter table public.signup_whitelist enable row level security;

-- Do not expose whitelist rows to clients directly.
drop policy if exists "signup_whitelist_no_select" on public.signup_whitelist;
create policy "signup_whitelist_no_select"
on public.signup_whitelist
for select
to anon, authenticated
using (false);

-- Helper RPC used by the sign-up page for user-friendly validation.
create or replace function public.is_signup_email_whitelisted(p_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.signup_whitelist w
    where w.enabled = true
      and lower(w.email) = lower(trim(p_email))
  );
$$;

grant execute on function public.is_signup_email_whitelisted(text) to anon, authenticated;

-- Hard enforcement in Supabase Auth: block user creation when email is not whitelisted.
create or replace function public.enforce_signup_whitelist()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.email is null or length(trim(new.email)) = 0 then
    raise exception 'Email is required';
  end if;

  if exists (
    select 1
    from public.signup_whitelist w
    where w.enabled = true
      and lower(w.email) = lower(trim(new.email))
  ) then
    return new;
  end if;

  raise exception 'Signup blocked: email is not whitelisted';
end;
$$;

drop trigger if exists trg_enforce_signup_whitelist on auth.users;
create trigger trg_enforce_signup_whitelist
before insert on auth.users
for each row
execute function public.enforce_signup_whitelist();

-- Example:
-- insert into public.signup_whitelist (email, note) values
-- ('guide1@example.com', 'Guide'),
-- ('guide2@example.com', 'Guide');
