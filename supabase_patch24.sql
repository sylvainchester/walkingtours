-- Patch 24: incoming booking email tracking for Gmail polling import

create table if not exists public.incoming_booking_emails (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text not null unique,
  gmail_thread_id text,
  subject text,
  from_email text,
  received_at timestamptz,
  raw_text text not null default '',
  matched_tour_id uuid references public.tours(id) on delete set null,
  matched_platform_name text,
  imported_participants jsonb not null default '[]'::jsonb,
  status text not null default 'received' check (status in ('received', 'imported', 'ignored', 'error')),
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists incoming_booking_emails_status_idx
  on public.incoming_booking_emails (status, created_at desc);

create index if not exists incoming_booking_emails_tour_idx
  on public.incoming_booking_emails (matched_tour_id);

alter table public.incoming_booking_emails enable row level security;

drop policy if exists "incoming_booking_emails_select_authed" on public.incoming_booking_emails;
create policy "incoming_booking_emails_select_authed" on public.incoming_booking_emails
  for select using (auth.uid() is not null);
