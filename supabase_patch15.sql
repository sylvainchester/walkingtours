-- Patch: allow deleting tours by assigned guide or creator

DROP POLICY IF EXISTS "tours_delete_own" ON public.tours;
DROP POLICY IF EXISTS "tours_delete_shared" ON public.tours;

CREATE POLICY "tours_delete_shared" ON public.tours
  FOR DELETE USING (
    guide_id = auth.uid()
    OR created_by = auth.uid()
  );
