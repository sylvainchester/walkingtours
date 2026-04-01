-- Patch 33: participant-level booking date and paid amount

alter table public.participants
  add column if not exists booked_at date,
  add column if not exists paid_amount numeric;

update public.participants p
set paid_amount = t.price_per_person
from public.tours t
where t.id = p.tour_id
  and p.paid_amount is null
  and t.price_per_person is not null;
