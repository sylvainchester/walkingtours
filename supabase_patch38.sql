-- Allow one tour to be assigned to every guide in its shared calendar.
alter table public.tours
  add column if not exists multiple_guides boolean not null default false;

