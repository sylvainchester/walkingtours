-- Patch: tour type shareable/private + private tour visibility rules

alter table public.tour_types
  add column if not exists shareable boolean not null default true;

alter table public.tours
  add column if not exists is_private boolean not null default false;

-- Backfill existing tours based on their type's shareable flag
update public.tours t
set is_private = (tt.shareable = false)
from public.tour_types tt
where t.type = tt.name
  and t.guide_id = tt.guide_id;

-- Only show shared tour types when they are shareable
DROP POLICY IF EXISTS "tour_types_select_shared" ON public.tour_types;
CREATE POLICY "tour_types_select_shared" ON public.tour_types
  FOR SELECT USING (
    guide_id = auth.uid()
    OR (
      shareable = true
      AND EXISTS (
        SELECT 1 FROM public.guide_shares gs
        WHERE (gs.guide_id = auth.uid() AND gs.shared_with_id = guide_id)
           OR (gs.shared_with_id = auth.uid() AND gs.guide_id = guide_id)
      )
    )
  );

-- Participants: block access on private tours unless owner
DROP POLICY IF EXISTS "participants_select_shared" ON public.participants;
DROP POLICY IF EXISTS "participants_insert_shared" ON public.participants;
DROP POLICY IF EXISTS "participants_update_shared" ON public.participants;
DROP POLICY IF EXISTS "participants_delete_shared" ON public.participants;

CREATE POLICY "participants_select_shared" ON public.participants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tours t
      WHERE t.id = participants.tour_id
        AND (t.is_private = false OR t.guide_id = auth.uid())
        AND (
          t.guide_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.guide_shares gs
            WHERE (gs.guide_id = auth.uid() AND gs.shared_with_id = t.guide_id)
               OR (gs.shared_with_id = auth.uid() AND gs.guide_id = t.guide_id)
          )
        )
    )
  );

CREATE POLICY "participants_insert_shared" ON public.participants
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tours t
      WHERE t.id = participants.tour_id
        AND t.status = 'accepted'
        AND t.participants_locked = false
        AND (t.is_private = false OR t.guide_id = auth.uid())
        AND (
          t.guide_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.guide_shares gs
            WHERE (gs.guide_id = auth.uid() AND gs.shared_with_id = t.guide_id)
               OR (gs.shared_with_id = auth.uid() AND gs.guide_id = t.guide_id)
          )
        )
    )
  );

CREATE POLICY "participants_update_shared" ON public.participants
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.tours t
      WHERE t.id = participants.tour_id
        AND t.participants_locked = false
        AND (t.is_private = false OR t.guide_id = auth.uid())
        AND (
          t.guide_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.guide_shares gs
            WHERE (gs.guide_id = auth.uid() AND gs.shared_with_id = t.guide_id)
               OR (gs.shared_with_id = auth.uid() AND gs.guide_id = t.guide_id)
          )
        )
    )
  );

CREATE POLICY "participants_delete_shared" ON public.participants
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.tours t
      WHERE t.id = participants.tour_id
        AND t.participants_locked = false
        AND (t.is_private = false OR t.guide_id = auth.uid())
        AND (
          t.guide_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.guide_shares gs
            WHERE (gs.guide_id = auth.uid() AND gs.shared_with_id = t.guide_id)
               OR (gs.shared_with_id = auth.uid() AND gs.guide_id = t.guide_id)
          )
        )
    )
  );
