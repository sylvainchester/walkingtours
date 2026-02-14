-- Patch: allow creating tours for shared guides

-- Replace insert policy to allow shared calendars
DROP POLICY IF EXISTS "tours_insert_own" ON public.tours;

CREATE POLICY "tours_insert_shared" ON public.tours
  FOR INSERT WITH CHECK (
    guide_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.guide_shares gs
      WHERE (gs.guide_id = auth.uid() AND gs.shared_with_id = guide_id)
         OR (gs.shared_with_id = auth.uid() AND gs.guide_id = guide_id)
    )
  );
