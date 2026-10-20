-- Keep-alive and backup check-ins.
-- The daily keep-alive job (/api/keepalive) and the nightly backup each write a row here,
-- so the free Supabase project sees activity every day and you can check when each last ran:
--   select * from public.heartbeat;
-- Only the server (service role) can read or write it.

create table if not exists public.heartbeat (
  source text primary key,
  at timestamptz not null default now(),
  detail text not null default ''
);

alter table public.heartbeat enable row level security;
revoke all on public.heartbeat from anon, authenticated;
grant all on public.heartbeat to service_role;
