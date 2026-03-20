alter table public.tours
  add column if not exists price_per_person numeric;

update public.tours t
set price_per_person = case
  when tt.payment_type = 'free' then coalesce((t.platform->>'commission_percent')::numeric, tt.fee_per_participant, 0)
  else coalesce(tt.ticket_price, 0)
end
from public.tour_types tt
where t.price_per_person is null
  and tt.guide_id = t.guide_id
  and lower(tt.name) = lower(t.type);

create index if not exists tours_source_tour_type_future_idx
  on public.tours (source_tour_type_id, date);
