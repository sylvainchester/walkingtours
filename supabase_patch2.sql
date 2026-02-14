-- Patch: enforce non-empty guide names on profile creation

alter table public.guide_profiles
  add constraint guide_profiles_first_name_nonempty check (length(trim(first_name)) > 0);

alter table public.guide_profiles
  add constraint guide_profiles_last_name_nonempty check (length(trim(last_name)) > 0);

create or replace function public.handle_new_user()
returns trigger as $$
declare
  fn text;
  ln text;
begin
  fn := nullif(trim(coalesce(new.raw_user_meta_data->>'first_name', '')), '');
  ln := nullif(trim(coalesce(new.raw_user_meta_data->>'last_name', '')), '');

  if fn is null or ln is null then
    raise exception 'First name and last name are required.';
  end if;

  insert into public.guide_profiles (id, first_name, last_name, email)
  values (new.id, fn, ln, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;
