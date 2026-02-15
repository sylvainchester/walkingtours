-- Patch: attendance status for participants

alter table public.participants
  add column if not exists attendance_status text check (attendance_status in ('arrived','absent'));
