-- ============================================================================
-- Migration 021 — Device conflict-guard scheduling (minimal DET-03 + AST-04
-- patch) + manual certification unlock (minimal TRN-02 patch).
--
-- Scope note: only detection_centers / devices / detection_appointments /
-- detection_sessions are created here — the four tables the CTO explicitly
-- asked to reuse for tonight's "device double-booking lock". The fuller
-- AST-04 asset-tracking tables (device_assignments, device_maintenance_logs,
-- device_incidents) are intentionally NOT created — not needed for the
-- conflict guard; tracked as open scope in BACKLOG.md.
--
-- Self-contained + fully idempotent — see migration_idempotency_convention.
--
-- Note: devices/detection_centers/detection_appointments/detection_sessions
-- were already created by the very first baseline migration (the initial
-- schema.sql apply, before numbered migrations 002+ began) — they exist live
-- with zero rows and their ORIGINAL own-analyst-only RLS policies (from this
-- doc's pre-2026-07-14 draft). This migration therefore can't rely on
-- `create table if not exists` alone to bring columns/constraints/policies
-- up to date — every column addition and policy is handled with its own
-- explicit `if not exists` / `drop ... if exists` guard below, including
-- dropping the old restrictive policies by their original names.
-- ============================================================================

create extension if not exists btree_gist;

create table if not exists detection_centers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id),
  name text not null,
  address text,
  operating_hours text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- "到府/外访检测" is modeled as a real (virtual) center row rather than a
-- nullable center_id special-case — keeps the location dropdown uniform
-- (one select, no conditional UI) while still covering on-site/outcall
-- detections, which is a real and common scenario for this business.
insert into detection_centers (name, status)
select '到府/外访检测', 'active'
where not exists (select 1 from detection_centers where name = '到府/外访检测');

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  serial_no text not null unique,
  model text,
  status text not null default 'active' check (status in ('active', 'maintenance', 'lost', 'retired')),
  current_center_id uuid references detection_centers(id),
  current_analyst_id uuid references analysts(id),
  purchased_at date,
  warranty_until date,
  next_maintenance_due date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists detection_appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  analyst_id uuid not null references analysts(id),
  device_id uuid not null references devices(id),
  center_id uuid references detection_centers(id),
  scheduled_at timestamptz not null,
  duration_minutes int not null default 30,
  time_range tstzrange,
  status text not null default 'booked' check (status in ('booked', 'confirmed', 'completed', 'cancelled', 'no_show')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- time_range can't be a GENERATED column: timestamptz + interval is STABLE,
-- not IMMUTABLE, and generated columns require an immutable expression. A
-- trigger has no such restriction, so it does the same job.
create or replace function set_appointment_time_range()
returns trigger
language plpgsql
as $$
begin
  new.time_range := tstzrange(new.scheduled_at, new.scheduled_at + (new.duration_minutes || ' minutes')::interval);
  return new;
end;
$$;

drop trigger if exists trg_set_appointment_time_range on detection_appointments;
create trigger trg_set_appointment_time_range
  before insert or update of scheduled_at, duration_minutes on detection_appointments
  for each row execute function set_appointment_time_range();

-- The device double-booking lock itself: a GiST exclusion constraint that
-- Postgres enforces on every insert/update, not application code — two
-- active (not cancelled/no_show) bookings for the same device can never
-- have overlapping time_range. Violating it raises SQLSTATE 23P01, which
-- the Server Action catches and turns into a friendly bilingual message.
-- Availability is checked on the DEVICE only, same as the original design —
-- analyst scheduling conflicts are coordinated manually, not enforced here.
alter table detection_appointments drop constraint if exists no_overlapping_device_bookings;
alter table detection_appointments
  add constraint no_overlapping_device_bookings
  exclude using gist (device_id with =, time_range with &&)
  where (status not in ('cancelled', 'no_show'));

create index if not exists idx_appointments_analyst on detection_appointments(analyst_id);
create index if not exists idx_appointments_customer on detection_appointments(customer_id);
create index if not exists idx_appointments_device on detection_appointments(device_id);

create table if not exists detection_sessions (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references detection_appointments(id),
  customer_id uuid not null references customers(id),
  analyst_id uuid not null references analysts(id),
  device_id uuid not null references devices(id),
  performed_at timestamptz not null default now(),
  status text not null default 'completed' check (status in ('completed', 'voided')),
  created_at timestamptz not null default now()
);
-- Added beyond the original architecture doc's column set: that draft
-- predates customer_children (migration 011) — a customer can have several
-- children, so the session needs to record which one was actually tested,
-- not just which family it belongs to. `create table if not exists` above
-- is a no-op if detection_sessions already existed (it does, from the
-- baseline apply), so this column is added explicitly rather than assumed.
alter table detection_sessions add column if not exists child_id uuid references customer_children(id);
create index if not exists idx_sessions_analyst on detection_sessions(analyst_id);
create index if not exists idx_sessions_customer on detection_sessions(customer_id);
create index if not exists idx_sessions_device on detection_sessions(device_id);

-- ----------------------------------------------------------------------------
-- RLS: devices/centers/appointments/sessions are readable by ANY
-- authenticated portal user — the whole point of the shared schedule view is
-- letting every analyst see who's booked what, to coordinate and avoid
-- double-booking a device. Writes stay back-office-only by policy (same
-- conservative-default pattern as tqc_one_page_reports); the Server Action's
-- app layer additionally allows the child's owning analyst, via the admin
-- client, matching the report-entry permission convention.
-- ----------------------------------------------------------------------------

alter table detection_centers enable row level security;
drop policy if exists "authenticated can read detection centers" on detection_centers;
create policy "authenticated can read detection centers" on detection_centers for select using (auth.role() = 'authenticated');
drop policy if exists "back office manages detection centers" on detection_centers;
create policy "back office manages detection centers" on detection_centers for all using (is_back_office()) with check (is_back_office());

-- devices/detection_appointments/detection_sessions already carry RLS
-- policies from the baseline apply, restricted to "own records only" — drop
-- those by their original names before installing the shared-visibility
-- versions this feature needs (see the file header note).
drop policy if exists "analyst reads own assigned device, back office reads all" on devices;
alter table devices enable row level security;
drop policy if exists "authenticated can read devices" on devices;
create policy "authenticated can read devices" on devices for select using (auth.role() = 'authenticated');
drop policy if exists "back office manages devices" on devices;
create policy "back office manages devices" on devices for all using (is_back_office()) with check (is_back_office());

drop policy if exists "analyst reads own appointments, back office reads all" on detection_appointments;
drop policy if exists "analyst manages own appointments, back office manages all" on detection_appointments;
alter table detection_appointments enable row level security;
drop policy if exists "authenticated can read appointments" on detection_appointments;
create policy "authenticated can read appointments" on detection_appointments for select using (auth.role() = 'authenticated');
drop policy if exists "back office writes appointments" on detection_appointments;
create policy "back office writes appointments" on detection_appointments for insert with check (is_back_office());
drop policy if exists "back office updates appointments" on detection_appointments;
create policy "back office updates appointments" on detection_appointments for update using (is_back_office());

drop policy if exists "analyst reads own sessions, back office reads all" on detection_sessions;
alter table detection_sessions enable row level security;
drop policy if exists "authenticated can read sessions" on detection_sessions;
create policy "authenticated can read sessions" on detection_sessions for select using (auth.role() = 'authenticated');
drop policy if exists "back office writes sessions" on detection_sessions;
create policy "back office writes sessions" on detection_sessions for insert with check (is_back_office());

-- ----------------------------------------------------------------------------
-- TRN-02 minimal patch: a manual "certification passed" flag on analysts,
-- plus a trigger that unlocks the resale detection_voucher the moment it's
-- set — same "commits atomically with the row that caused it" philosophy as
-- every other trigger in this project (derive_child_tags_one_page(),
-- commission_engine.sql, etc.), so the unlock can never happen out of step
-- with the certification flag, regardless of what path updates analysts.
-- ----------------------------------------------------------------------------

alter table analysts add column if not exists certification_passed_at timestamptz;

create or replace function unlock_resale_voucher_on_certification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.certification_passed_at is not null and old.certification_passed_at is null then
    update detection_vouchers
    set status = 'issued'
    where analyst_id = new.id and voucher_type = 'resale' and status = 'locked';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_unlock_resale_voucher_on_certification on analysts;
create trigger trg_unlock_resale_voucher_on_certification
  after update of certification_passed_at on analysts
  for each row execute function unlock_resale_voucher_on_certification();
