-- Patch 25: booking import drafts for Gmail polling review flow

alter table public.incoming_booking_emails
  drop constraint if exists incoming_booking_emails_status_check;

alter table public.incoming_booking_emails
  add column if not exists llm_extraction jsonb not null default '{}'::jsonb,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

alter table public.incoming_booking_emails
  add constraint incoming_booking_emails_status_check
  check (status in ('received', 'pending_review', 'confirmed', 'rejected', 'ignored', 'error'));
