-- Patch 27: store raw HTML for booking import email rendering

alter table public.incoming_booking_emails
  add column if not exists raw_html text not null default '';
