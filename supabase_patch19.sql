-- Patch 19: share validation toggle + multi-platform prepaid tour types

alter table public.guide_shares
  add column if not exists requires_tour_validation boolean not null default true;

drop policy if exists "guide_shares_update_related" on public.guide_shares;
create policy "guide_shares_update_related" on public.guide_shares
  for update
  using (guide_id = auth.uid() or shared_with_id = auth.uid())
  with check (guide_id = auth.uid() or shared_with_id = auth.uid());

alter table public.tour_types
  add column if not exists platforms jsonb not null default '[]'::jsonb;

alter table public.tours
  add column if not exists platform jsonb;

-- Backfill legacy prepaid configuration into a first platform entry when needed.
update public.tour_types
set platforms = jsonb_build_array(
  jsonb_build_object(
    'id', gen_random_uuid()::text,
    'name', coalesce(nullif(trim(invoice_org_name), ''), 'Default platform'),
    'commission_percent', coalesce(commission_percent, 0),
    'requires_invoice', true,
    'email', nullif(trim(invoice_org_address), ''),
    'description', null
  )
)
where payment_type = 'prepaid'
  and coalesce(jsonb_array_length(platforms), 0) = 0
  and (
    invoice_org_name is not null
    or invoice_org_address is not null
    or commission_percent is not null
  );
