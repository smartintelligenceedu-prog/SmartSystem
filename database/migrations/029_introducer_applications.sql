-- ============================================================================
-- Migration 029 — Introducer self-service application queue (2026-07-15,
-- CTO request): introducers previously could only be created directly by
-- back office (see admin/introducers/actions.ts). This adds a public
-- self-application path mirroring the analyst /register flow, but much
-- lighter — no kit purchase, no document upload, no certification. A
-- submission just parks here as 'pending' until back office approves it,
-- at which point the real party/individual/introducers rows are created
-- (same shape as adminCreateIntroducer).
--
-- Self-contained + idempotent: safe to rerun.
-- ============================================================================

create table if not exists introducer_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text not null,
  bank_name text,
  bank_account_name text,
  bank_account_no text,
  sponsor_referral_code text,
  sponsor_id uuid references introducers(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  resulting_introducer_id uuid references introducers(id),
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_introducer_applications_status on introducer_applications(status);

alter table introducer_applications enable row level security;

-- Public submission goes through a Server Action using the admin client
-- (bypasses RLS), same posture as registration_orders / analysts in
-- register/actions.ts — anon has zero direct table access by design. Back
-- office needs to browse + update the queue through their own RLS-respecting
-- session, hence this policy.
drop policy if exists "back office only" on introducer_applications;
create policy "back office only" on introducer_applications for all using (is_back_office()) with check (is_back_office());
