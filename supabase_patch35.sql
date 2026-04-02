-- Patch 35: cautious retroactive backfill of participant creation_source from stored import emails
--
-- Strategy:
-- - only use confirmed booking imports
-- - match on tour + participant signature (name, group size, platform)
-- - require participant created_at to be close to the import confirmation time
-- - when an import contains duplicates of the same signature, only mark as many rows as were imported
--
-- This intentionally prefers false negatives over false positives.

with confirmed_imports as (
  select
    e.id as email_id,
    e.matched_tour_id as tour_id,
    coalesce(e.reviewed_at, e.processed_at, e.created_at) as import_at,
    lower(trim(coalesce(item.participant->>'name', ''))) as name_key,
    coalesce((item.participant->>'group_size')::integer, 0) as group_size,
    lower(trim(coalesce(item.participant->>'platform_name', ''))) as platform_key,
    nullif(trim(coalesce(item.participant->>'booked_at', '')), '')::date as booked_at,
    case
      when nullif(trim(coalesce(item.participant->>'paid_amount', '')), '') is null then null
      else (item.participant->>'paid_amount')::numeric
    end as paid_amount
  from public.incoming_booking_emails e
  cross join lateral jsonb_array_elements(e.imported_participants) as item(participant)
  where e.status = 'confirmed'
    and e.matched_tour_id is not null
),
grouped_imports as (
  select
    email_id,
    tour_id,
    import_at,
    name_key,
    group_size,
    platform_key,
    booked_at,
    paid_amount,
    count(*) as import_count
  from confirmed_imports
  where name_key <> ''
    and group_size > 0
  group by
    email_id,
    tour_id,
    import_at,
    name_key,
    group_size,
    platform_key,
    booked_at,
    paid_amount
),
ranked_participants as (
  select
    g.email_id,
    p.id as participant_id,
    row_number() over (
      partition by
        g.email_id,
        g.tour_id,
        g.name_key,
        g.group_size,
        g.platform_key,
        g.booked_at,
        g.paid_amount
      order by p.created_at asc, p.id asc
    ) as participant_rank,
    g.import_count
  from grouped_imports g
  join public.participants p
    on p.tour_id = g.tour_id
   and lower(trim(coalesce(p.name, ''))) = g.name_key
   and coalesce(p.group_size, 0) = g.group_size
   and lower(trim(coalesce(p.platform_name, ''))) = g.platform_key
   and p.created_at between (g.import_at - interval '15 minutes') and (g.import_at + interval '15 minutes')
   and (g.booked_at is null or p.booked_at = g.booked_at)
   and (g.paid_amount is null or p.paid_amount = g.paid_amount)
),
matched_participants as (
  select participant_id
  from ranked_participants
  where participant_rank <= import_count
)
update public.participants p
set creation_source = 'email_import'
from matched_participants m
where p.id = m.participant_id
  and p.creation_source <> 'email_import';
