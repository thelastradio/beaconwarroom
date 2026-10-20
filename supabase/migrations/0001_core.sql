-- Beacon War Room: core schema, access rules and functions.
-- Run once in the Supabase SQL editor (or `supabase db push`).

create extension if not exists pgcrypto;

-- ---------- types ----------
create type public.member_role as enum ('controller', 'poc', 'viewer');
create type public.item_status as enum ('not_started', 'in_progress', 'done', 'blocked', 'na');
create type public.event_phase as enum ('planning', 'build', 'live', 'breakdown', 'debrief');
create type public.finding_status as enum ('pending', 'approved', 'rejected');

-- ---------- people ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  is_owner boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- catalog ----------
create table public.departments (
  key text primary key,
  name text not null,
  owns text not null default '',
  sort int not null
);

create table public.template_items (
  id uuid primary key default gen_random_uuid(),
  dept_key text not null references public.departments(key) on delete cascade,
  title text not null,
  phase public.event_phase not null,
  anchor text not null default 'start' check (anchor in ('start', 'end')),
  offset_minutes int not null,
  critical boolean not null default false,
  photo_required boolean not null default false,
  sort int not null default 0
);

-- ---------- events ----------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text not null,
  city text not null,
  venue text not null default '',
  venue_type text not null default 'licensed_venue'
    check (venue_type in ('licensed_venue', 'open_ground', 'club', 'other')),
  timezone text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int,
  ticketed boolean not null default true,
  alcohol boolean not null default false,
  food_stalls boolean not null default false,
  special_effects boolean not null default false,
  artist_nationalities text[] not null default '{}',
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.event_departments (
  event_id uuid not null references public.events(id) on delete cascade,
  dept_key text not null references public.departments(key),
  enabled boolean not null default true,
  primary key (event_id, dept_key)
);

create table public.event_members (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null,
  dept_key text references public.departments(key),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id),
  check ((role = 'poc') = (dept_key is not null))
);
-- one POC per department per event
create unique index event_members_one_poc on public.event_members (event_id, dept_key) where role = 'poc';

-- ---------- access helpers (security definer: they read membership without recursion) ----------
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_owner from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.my_role(eid uuid) returns public.member_role
language sql stable security definer set search_path = public as $$
  select role from public.event_members where event_id = eid and user_id = auth.uid()
$$;

create or replace function public.my_dept(eid uuid) returns text
language sql stable security definer set search_path = public as $$
  select dept_key from public.event_members where event_id = eid and user_id = auth.uid()
$$;

create or replace function public.is_member(eid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or exists (select 1 from public.event_members where event_id = eid and user_id = auth.uid())
$$;

create or replace function public.can_control(eid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or coalesce(public.my_role(eid) = 'controller', false)
$$;

create or replace function public.can_edit_dept(eid uuid, dept text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_control(eid)
      or coalesce(public.my_role(eid) = 'poc' and public.my_dept(eid) = dept, false)
$$;

create or replace function public.can_act(eid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_control(eid) or coalesce(public.my_role(eid) = 'poc', false)
$$;

-- ---------- checklist ----------
create table public.items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  dept_key text not null references public.departments(key),
  title text not null,
  details text not null default '',
  phase public.event_phase not null,
  due_at timestamptz,
  critical boolean not null default false,
  photo_required boolean not null default false,
  status public.item_status not null default 'not_started',
  last_note text,
  last_photo_path text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  source text not null default 'manual' check (source in ('template', 'compliance', 'manual')),
  finding_id uuid,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index items_event on public.items (event_id, dept_key);

create table public.item_updates (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  status public.item_status not null,
  note text,
  photo_path text,
  client_at timestamptz,
  applied boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index item_updates_item on public.item_updates (item_id, created_at desc);

-- Status changes only happen through item_updates, so every change is kept (audit trail).
create or replace function public.apply_item_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare it public.items;
declare at_ts timestamptz;
begin
  select * into it from public.items where id = new.item_id for update;
  if it.id is null then raise exception 'item not found'; end if;
  if it.event_id <> new.event_id then raise exception 'item does not belong to this event'; end if;
  if new.status = 'done' and it.photo_required and new.photo_path is null then
    raise exception 'photo_required: this item needs a photo before it can be marked done';
  end if;
  -- offline updates carry the time they were made; never let a stale one overwrite a newer status
  at_ts := least(coalesce(new.client_at, now()), now());
  if at_ts < it.updated_at and it.updated_by is not null then
    new.applied := false;
    return new;
  end if;
  update public.items
     set status = new.status,
         last_note = new.note,
         last_photo_path = coalesce(new.photo_path, last_photo_path),
         updated_by = new.created_by,
         updated_at = at_ts
   where id = new.item_id;
  return new;
end $$;

create trigger item_updates_apply before insert on public.item_updates
  for each row execute function public.apply_item_update();

-- ---------- incidents ----------
create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  level smallint not null check (level between 1 and 4),
  dept_key text not null references public.departments(key),
  location text not null default '',
  title text not null,
  description text not null default '',
  photo_path text,
  status text not null default 'open' check (status in ('open', 'closed')),
  raised_by uuid not null default auth.uid() references auth.users(id),
  raised_at timestamptz not null default now(),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  close_note text
);
create index incidents_event on public.incidents (event_id, status);

create table public.incident_updates (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  note text not null,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---------- broadcasts ----------
create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  dept_key text references public.departments(key),
  message text not null,
  urgent boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---------- compliance research ----------
create table public.compliance_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  cache_key text not null,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  categories_done text[] not null default '{}',
  reused_from uuid references public.compliance_runs(id),
  searches int not null default 0,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  error text,
  started_by uuid references auth.users(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index compliance_runs_cache on public.compliance_runs (cache_key, finished_at desc);

create table public.compliance_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.compliance_runs(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  category text not null,
  requirement text not null,
  authority text not null default '',
  lead_time_days int,
  fee text not null default '',
  source_url text not null default '',
  source_quote text not null default '',
  official boolean not null default false,
  status public.finding_status not null default 'pending',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  reject_reason text,
  item_id uuid references public.items(id) on delete set null,
  created_at timestamptz not null default now()
);
create index compliance_findings_event on public.compliance_findings (event_id, status);

create or replace function public.can_compliance(eid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_control(eid)
      or coalesce(public.my_role(eid) = 'poc' and public.my_dept(eid) = 'licensing', false)
$$;

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.template_items enable row level security;
alter table public.events enable row level security;
alter table public.event_departments enable row level security;
alter table public.event_members enable row level security;
alter table public.items enable row level security;
alter table public.item_updates enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_updates enable row level security;
alter table public.broadcasts enable row level security;
alter table public.compliance_runs enable row level security;
alter table public.compliance_findings enable row level security;

-- profiles: yourself, the owner, and people who share an event with you (to show names)
create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid() or public.is_owner() or (is_owner and auth.uid() is not null) or exists (
    select 1 from public.event_members a join public.event_members b on a.event_id = b.event_id
    where a.user_id = auth.uid() and b.user_id = profiles.id)
);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- nobody but the database admin can change is_owner or email
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;

create policy departments_read on public.departments for select to authenticated using (true);
create policy departments_write on public.departments for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy templates_read on public.template_items for select to authenticated using (true);
create policy templates_write on public.template_items for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy events_read on public.events for select to authenticated using (public.is_member(id));
create policy events_update on public.events for update to authenticated using (public.can_control(id)) with check (public.can_control(id));
create policy events_delete on public.events for delete to authenticated using (public.is_owner());
-- events are created through create_event()

create policy evdept_read on public.event_departments for select to authenticated using (public.is_member(event_id));
create policy evdept_update on public.event_departments for update to authenticated using (public.can_control(event_id)) with check (public.can_control(event_id));

create policy members_read on public.event_members for select to authenticated using (public.is_member(event_id));
-- only the owner manages people; members are added through the invite server function (service role)
create policy members_delete on public.event_members for delete to authenticated using (public.is_owner());
create policy members_update on public.event_members for update to authenticated using (public.is_owner()) with check (public.is_owner());

create policy items_read on public.items for select to authenticated using (public.is_member(event_id));
create policy items_insert on public.items for insert to authenticated with check (public.can_control(event_id));
create policy items_update on public.items for update to authenticated using (public.can_control(event_id)) with check (public.can_control(event_id));
create policy items_delete on public.items for delete to authenticated using (public.can_control(event_id));
-- status columns may only change through item_updates
revoke update on public.items from authenticated, anon;
grant update (title, details, phase, due_at, critical, photo_required, sort, dept_key) on public.items to authenticated;

create policy item_updates_read on public.item_updates for select to authenticated using (public.is_member(event_id));
create policy item_updates_insert on public.item_updates for insert to authenticated with check (
  created_by = auth.uid()
  and public.can_edit_dept(event_id, (select dept_key from public.items i where i.id = item_id))
);

create policy incidents_read on public.incidents for select to authenticated using (public.is_member(event_id));
create policy incidents_insert on public.incidents for insert to authenticated with check (
  raised_by = auth.uid() and status = 'open' and closed_at is null and public.can_act(event_id));
-- closing goes through close_incident(); controllers may still edit details
create policy incidents_update on public.incidents for update to authenticated using (public.can_control(event_id)) with check (public.can_control(event_id));

create policy inc_updates_read on public.incident_updates for select to authenticated using (public.is_member(event_id));
create policy inc_updates_insert on public.incident_updates for insert to authenticated with check (
  created_by = auth.uid() and public.can_act(event_id)
  and event_id = (select i.event_id from public.incidents i where i.id = incident_id));

create policy broadcasts_read on public.broadcasts for select to authenticated using (
  public.is_member(event_id) and (dept_key is null or public.can_control(event_id) or dept_key = public.my_dept(event_id)));
create policy broadcasts_insert on public.broadcasts for insert to authenticated with check (
  created_by = auth.uid() and public.can_control(event_id));

create policy runs_read on public.compliance_runs for select to authenticated using (public.can_compliance(event_id));
create policy findings_read on public.compliance_findings for select to authenticated using (public.can_compliance(event_id));
-- runs and findings are written by the compliance server function; reviews go through review_finding()

-- ---------- functions called by the app ----------
create or replace function public.create_event(
  p_name text, p_country text, p_city text, p_venue text, p_venue_type text, p_timezone text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_capacity int,
  p_ticketed boolean, p_alcohol boolean, p_food_stalls boolean, p_special_effects boolean,
  p_artist_nationalities text[], p_disabled_departments text[] default '{}'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  if not public.is_owner() then raise exception 'only the owner can create events'; end if;
  insert into public.events (name, country, city, venue, venue_type, timezone, starts_at, ends_at, capacity,
                             ticketed, alcohol, food_stalls, special_effects, artist_nationalities, created_by)
  values (p_name, p_country, p_city, p_venue, p_venue_type, p_timezone, p_starts_at, p_ends_at, p_capacity,
          p_ticketed, p_alcohol, p_food_stalls, p_special_effects, coalesce(p_artist_nationalities, '{}'), auth.uid())
  returning id into eid;

  insert into public.event_departments (event_id, dept_key, enabled)
  select eid, d.key, not (d.key = any (coalesce(p_disabled_departments, '{}'))) from public.departments d;

  insert into public.items (event_id, dept_key, title, phase, due_at, critical, photo_required, source, sort)
  select eid, t.dept_key, t.title, t.phase,
         (case when t.anchor = 'end' then p_ends_at else p_starts_at end) + make_interval(mins => t.offset_minutes),
         t.critical, t.photo_required, 'template', t.sort
  from public.template_items t;
  return eid;
end $$;

create or replace function public.close_incident(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare inc public.incidents;
begin
  select * into inc from public.incidents where id = p_id for update;
  if inc.id is null or not public.is_member(inc.event_id) then raise exception 'incident not found'; end if;
  if inc.status = 'closed' then return; end if;
  if inc.level = 1 and not public.can_control(inc.event_id) then
    raise exception 'only the Event Controller can close a critical (L1) incident';
  end if;
  if inc.level > 1 and not public.can_edit_dept(inc.event_id, inc.dept_key) then
    raise exception 'only the Event Controller or this department''s POC can close this incident';
  end if;
  update public.incidents set status = 'closed', closed_by = auth.uid(), closed_at = now(), close_note = p_note where id = p_id;
  insert into public.incident_updates (incident_id, event_id, note, created_by)
  values (p_id, inc.event_id, 'Closed: ' || coalesce(nullif(p_note, ''), 'no note'), auth.uid());
end $$;

create or replace function public.reopen_incident(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare inc public.incidents;
begin
  select * into inc from public.incidents where id = p_id for update;
  if inc.id is null or not public.can_edit_dept(inc.event_id, inc.dept_key) then raise exception 'not allowed'; end if;
  update public.incidents set status = 'open', closed_by = null, closed_at = null where id = p_id;
  insert into public.incident_updates (incident_id, event_id, note, created_by)
  values (p_id, inc.event_id, 'Reopened: ' || coalesce(nullif(p_note, ''), 'no note'), auth.uid());
end $$;

create or replace function public.review_finding(p_id uuid, p_approve boolean, p_reason text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare f public.compliance_findings;
declare ev public.events;
declare new_item uuid;
begin
  select * into f from public.compliance_findings where id = p_id for update;
  if f.id is null or not public.can_compliance(f.event_id) then raise exception 'not allowed'; end if;
  if f.status <> 'pending' then raise exception 'already reviewed'; end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required to reject'; end if;
  select * into ev from public.events where id = f.event_id;
  if p_approve then
    insert into public.items (event_id, dept_key, title, details, phase, due_at, critical, source, finding_id)
    values (f.event_id, 'licensing', f.requirement,
            concat_ws(E'\n', nullif('Authority: ' || f.authority, 'Authority: '), nullif('Fee: ' || f.fee, 'Fee: '),
                      nullif('Source: ' || f.source_url, 'Source: '), case when not f.official then 'Source is not official: verify' end),
            'planning',
            case when f.lead_time_days is null then ev.starts_at - interval '7 days'
                 else ev.starts_at - make_interval(days => f.lead_time_days) end,
            true, 'compliance', f.id)
    returning id into new_item;
  end if;
  update public.compliance_findings
     set status = case when p_approve then 'approved'::public.finding_status else 'rejected'::public.finding_status end,
         reviewed_by = auth.uid(), reviewed_at = now(), reject_reason = p_reason, item_id = new_item
   where id = p_id;
  return new_item;
end $$;

-- functions are callable only by signed-in users
revoke execute on function public.create_event, public.close_incident, public.reopen_incident, public.review_finding from public, anon;
grant execute on function public.create_event, public.close_incident, public.reopen_incident, public.review_finding to authenticated;

-- ---------- live updates ----------
alter publication supabase_realtime add table public.items, public.item_updates, public.incidents,
  public.incident_updates, public.broadcasts, public.event_members, public.compliance_findings;
