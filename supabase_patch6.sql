-- Patch: allow shared calendars to access participants for shared tours

DROP POLICY IF EXISTS "participants_select_own" ON public.participants;
DROP POLICY IF EXISTS "participants_insert_own" ON public.participants;
DROP POLICY IF EXISTS "participants_update_own" ON public.participants;
DROP POLICY IF EXISTS "participants_delete_own" ON public.participants;

CREATE POLICY "participants_select_shared" ON public.participants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tours t
      WHERE t.id = participants.tour_id
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
