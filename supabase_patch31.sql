create table if not exists public.gmail_health_logs (
  id uuid primary key default gen_random_uuid(),
  ok boolean not null,
  checked_at timestamptz not null default now(),
  checked_by uuid references auth.users(id) on delete set null,
  mode text not null default 'token',
  gmail_address text,
  gmail_unread_count integer,
  oauth_client_id_masked text,
  error_code text,
  error_message text
);

create index if not exists gmail_health_logs_checked_at_idx
  on public.gmail_health_logs (checked_at desc);
