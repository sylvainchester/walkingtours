-- Patch 26: restrict booking import visibility to the guide whose email forwarded the email

drop policy if exists "incoming_booking_emails_select_authed" on public.incoming_booking_emails;
drop policy if exists "incoming_booking_emails_select_sender" on public.incoming_booking_emails;

create policy "incoming_booking_emails_select_sender" on public.incoming_booking_emails
  for select using (
    auth.uid() is not null
    and lower(coalesce(from_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
