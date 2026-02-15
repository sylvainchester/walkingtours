-- Patch: invoice PDF storage on participant lock

alter table public.tours add column if not exists invoice_path text;

insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

DROP POLICY IF EXISTS "invoices_select_auth" ON storage.objects;
DROP POLICY IF EXISTS "invoices_insert_auth" ON storage.objects;
DROP POLICY IF EXISTS "invoices_update_auth" ON storage.objects;
DROP POLICY IF EXISTS "invoices_delete_auth" ON storage.objects;

CREATE POLICY "invoices_select_auth" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'invoices');

CREATE POLICY "invoices_insert_auth" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'invoices');

CREATE POLICY "invoices_update_auth" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'invoices')
  WITH CHECK (bucket_id = 'invoices');

CREATE POLICY "invoices_delete_auth" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'invoices');
