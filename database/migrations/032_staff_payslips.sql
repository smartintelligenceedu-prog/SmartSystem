-- ============================================================================
-- Migration 032 — Manual staff payslips (2026-07-15, CTO request): back
-- office has hired plain staff (e.g. an admin) who are neither an analyst
-- nor an introducer, so the existing commission-derived analyst_payslips /
-- introducer_commission_statements have nowhere to plug them in. This is a
-- deliberately manual, one-off payslip — back office types an amount each
-- time a salary is paid, same posture as adminAdjustCommission's manual
-- override, not an automatic recurring-salary engine.
--
-- Scoped by party_id (not user_id) to match every other identity-scoped
-- table in this schema (customers, introducers, analysts all key off
-- party_id, not the login row) — current_party_id() already exists and
-- covers self-view for free.
--
-- Self-contained + idempotent: every statement guarded, safe to rerun.
-- ============================================================================

create table if not exists staff_payslips (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties(id),
  period_start date not null,
  period_end date not null,
  gross_amount numeric(12,2) not null check (gross_amount >= 0),
  description text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_staff_payslips_party on staff_payslips(party_id);

alter table staff_payslips enable row level security;

drop policy if exists "self or back office reads staff payslips" on staff_payslips;
create policy "self or back office reads staff payslips" on staff_payslips for select
  using (party_id = current_party_id() or is_back_office());

drop policy if exists "back office writes staff payslips" on staff_payslips;
create policy "back office writes staff payslips" on staff_payslips for insert with check (is_back_office());
