-- ============================================================================
-- Migration 022 — Two fixes in one file (requested together, both urgent):
--
-- 1. DET-03/AST-04 correction: migration 021 wrongly merged "reserve a
--    device time slot" and "enter the TQC assessment scores" into a single
--    form/save. Real business flow: a slot is booked BEFORE the assessment
--    happens (zero report data exists yet), and scores are only known AFTER
--    the physical test. Forcing them together caused front-line staff to
--    type junk placeholder scores just to reserve a machine, corrupting the
--    CRM auto-tagging system. This migration adds what's needed to split
--    them into two independent steps: a 'pending_assessment' appointment
--    status, and a child_id on detection_appointments (so "this child's
--    outstanding appointments" can be listed on the report page).
--
-- 2. HR-09 minimal patch: monthly commission payout automation — analyst
--    payslips and introducer commission statements, both generated from
--    already-approved commission_records, in one atomic run per period.
--
-- Self-contained + fully idempotent — see migration_idempotency_convention.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Part 1: appointment/report decoupling
-- ----------------------------------------------------------------------------

alter table detection_appointments drop constraint if exists detection_appointments_status_check;
alter table detection_appointments
  add constraint detection_appointments_status_check
  check (status in ('booked', 'confirmed', 'pending_assessment', 'completed', 'cancelled', 'no_show'));

-- Which child this booking is for — needed to list "this child's outstanding
-- appointments" on the report page. The original architecture doc predates
-- customer_children (migration 011), so this wasn't in the original design.
alter table detection_appointments add column if not exists child_id uuid references customer_children(id);
create index if not exists idx_appointments_child on detection_appointments(child_id);

-- ----------------------------------------------------------------------------
-- Part 2: monthly commission payout automation (minimal HR-09 patch)
--
-- Deliberately NOT reusing payroll_runs/payslips (schema.sql) — those are
-- FK'd to employees(id), i.e. internal salaried staff, and analysts are
-- commission-based partners, never employees rows (see the Party-model
-- rationale in the architecture doc's HR/Agent split). Reusing them would
-- either require fake employees rows for every analyst (wrong) or loosening
-- the FK (breaks the internal-payroll feature's own integrity). Dedicated
-- tables instead, mirroring the same run/statement shape.
-- ----------------------------------------------------------------------------

create table if not exists commission_payout_runs (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status text not null default 'completed' check (status in ('completed', 'voided')),
  processed_by uuid references users(id),
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (period_start, period_end)
);

-- Tags exactly which payout run paid out a given commission record — the
-- audit trail from a payslip/statement line back to the underlying
-- transaction. Nullable: most records are unpaid until a run claims them.
alter table commission_records add column if not exists payout_run_id uuid references commission_payout_runs(id);
create index if not exists idx_commission_records_payout_run on commission_records(payout_run_id);

create table if not exists analyst_payslips (
  id uuid primary key default gen_random_uuid(),
  payout_run_id uuid not null references commission_payout_runs(id),
  analyst_id uuid not null references analysts(id),
  gross_amount numeric(12,2) not null,
  created_at timestamptz not null default now(),
  unique (payout_run_id, analyst_id)
);
create index if not exists idx_analyst_payslips_analyst on analyst_payslips(analyst_id);

create table if not exists introducer_commission_statements (
  id uuid primary key default gen_random_uuid(),
  payout_run_id uuid not null references commission_payout_runs(id),
  introducer_id uuid not null references introducers(id),
  gross_amount numeric(12,2) not null,
  created_at timestamptz not null default now(),
  unique (payout_run_id, introducer_id)
);
create index if not exists idx_introducer_statements_introducer on introducer_commission_statements(introducer_id);

alter table commission_payout_runs enable row level security;
drop policy if exists "back office manages payout runs" on commission_payout_runs;
create policy "back office manages payout runs" on commission_payout_runs for all using (is_back_office()) with check (is_back_office());

alter table analyst_payslips enable row level security;
drop policy if exists "analyst reads own payslips, back office reads all" on analyst_payslips;
create policy "analyst reads own payslips, back office reads all" on analyst_payslips for select
  using (analyst_id = current_analyst_id() or is_back_office());
drop policy if exists "back office writes payslips" on analyst_payslips;
create policy "back office writes payslips" on analyst_payslips for insert with check (is_back_office());

alter table introducer_commission_statements enable row level security;
drop policy if exists "introducer reads own statements, back office reads all" on introducer_commission_statements;
create policy "introducer reads own statements, back office reads all" on introducer_commission_statements for select
  using (introducer_id = current_introducer_id() or is_back_office());
drop policy if exists "back office writes statements" on introducer_commission_statements;
create policy "back office writes statements" on introducer_commission_statements for insert with check (is_back_office());
