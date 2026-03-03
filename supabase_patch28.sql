-- Patch 28: allow guides to define a secondary email for booking imports

alter table public.guide_profiles
  add column if not exists import_email text;

drop policy if exists "incoming_booking_emails_select_sender" on public.incoming_booking_emails;

create policy "incoming_booking_emails_select_sender" on public.incoming_booking_emails
  for select using (
    auth.uid() is not null
    and exists (
      select 1
      from public.guide_profiles gp
      where gp.id = auth.uid()
        and lower(coalesce(incoming_booking_emails.from_email, '')) in (
          lower(coalesce(gp.email, '')),
          lower(coalesce(gp.import_email, ''))
        )
    )
  );
