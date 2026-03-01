-- Patch 21: allow shared tour reassignment/update between connected guides

drop policy if exists "tours_update_own" on public.tours;
drop policy if exists "tours_update_shared" on public.tours;

create policy "tours_update_shared" on public.tours
  for update
  using (
    guide_id = auth.uid()
    or created_by = auth.uid()
    or exists (
      select 1
      from public.guide_shares gs
      where (gs.guide_id = auth.uid() and gs.shared_with_id = tours.guide_id)
         or (gs.shared_with_id = auth.uid() and gs.guide_id = tours.guide_id)
    )
  )
  with check (
    created_by = auth.uid()
    or guide_id = auth.uid()
    or exists (
      select 1
      from public.guide_shares gs
      where (gs.guide_id = auth.uid() and gs.shared_with_id = tours.guide_id)
         or (gs.shared_with_id = auth.uid() and gs.guide_id = tours.guide_id)
    )
  );
