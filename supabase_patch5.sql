-- Patch: pending approval for tours created on shared calendars

-- Columns for approval workflow
alter table public.tours add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.tours add column if not exists status text not null default 'accepted' check (status in ('pending', 'accepted'));

-- Backfill for existing data
update public.tours set created_by = coalesce(created_by, guide_id);
update public.tours set status = 'accepted' where status is null;

-- Update RLS policies for shared reads/inserts
DROP POLICY IF EXISTS "tours_select_own" ON public.tours;
DROP POLICY IF EXISTS "tours_insert_own" ON public.tours;
DROP POLICY IF EXISTS "tours_insert_shared" ON public.tours;

CREATE POLICY "tours_select_shared" ON public.tours
  FOR SELECT USING (
    guide_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.guide_shares gs
      WHERE (gs.guide_id = auth.uid() AND gs.shared_with_id = guide_id)
         OR (gs.shared_with_id = auth.uid() AND gs.guide_id = guide_id)
    )
  );

CREATE POLICY "tours_insert_shared" ON public.tours
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND (
      guide_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.guide_shares gs
        WHERE (gs.guide_id = auth.uid() AND gs.shared_with_id = guide_id)
           OR (gs.shared_with_id = auth.uid() AND gs.guide_id = guide_id)
      )
    )
  );
