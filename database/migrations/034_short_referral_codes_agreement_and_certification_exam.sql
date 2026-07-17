-- ============================================================================
-- Migration 034 — three CTO requests bundled together (2026-07-17):
--
-- 1. Short analyst referral codes: analysts.referral_code was a 32-char
--    random hex string (from gen_random_uuid()) — unreadable, unshareable
--    out loud. Switched to a sequential "AG-0001" style code. Safe to
--    regenerate for existing rows because nothing references referral_code
--    by foreign key — sponsor_id/assigned_leader_id point at analysts.id
--    (uuid), the code is only ever looked up by text at registration time.
--
-- 2. registration_orders.agreement_accepted_at: audit trail proving the
--    registrant ticked the Agent Agreement / Terms & Conditions checkbox
--    (added in the /register form) before submitting.
--
-- 3. A minimal self-graded certification exam: two question banks (the CTO
--    supplies the actual questions/answers separately), analyst answers one
--    randomly-picked set from their own portal, server grades it against a
--    configurable passing score, and — same as the existing manual
--    adminApproveCertification() action — a pass sets
--    analysts.certification_passed_at, which already fires
--    trg_unlock_resale_voucher_on_certification (migration 021). No changes
--    needed to that trigger. The existing manual admin button stays as a
--    fallback/override; this just adds a self-service path.
--
-- Self-contained + idempotent: every statement guarded, safe to rerun.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Short referral codes
-- ---------------------------------------------------------------------------

create sequence if not exists analyst_referral_code_seq;

-- Only touches rows that don't already look like "AG-0001" — reruns are a
-- no-op once every row has been converted, so this never burns extra
-- sequence numbers on a second apply.
do $$
declare
  r record;
begin
  for r in select id from analysts where referral_code !~ '^AG-[0-9]{4,}$' order by created_at loop
    update analysts set referral_code = 'AG-' || lpad(nextval('analyst_referral_code_seq')::text, 4, '0') where id = r.id;
  end loop;
end $$;

alter table analysts alter column referral_code set default ('AG-' || lpad(nextval('analyst_referral_code_seq')::text, 4, '0'));

-- ---------------------------------------------------------------------------
-- 2. Registration agreement acceptance audit trail
-- ---------------------------------------------------------------------------

alter table registration_orders add column if not exists agreement_accepted_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. Certification exam
-- ---------------------------------------------------------------------------

create table if not exists certification_questions (
  id uuid primary key default gen_random_uuid(),
  question_set smallint not null check (question_set in (1, 2)),
  question_text text not null,
  choices jsonb not null, -- e.g. ["Choice A", "Choice B", "Choice C", "Choice D"]
  correct_choice_index smallint not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_certification_questions_set on certification_questions(question_set, is_active);

-- Singleton settings row (id is always `true`) — just the passing score for
-- now; same shape as company settings' single-JSON-row pattern would be
-- overkill for one integer, so this is a plain table instead.
create table if not exists certification_settings (
  id boolean primary key default true check (id),
  passing_score integer not null default 8,
  updated_at timestamptz not null default now()
);
insert into certification_settings (id, passing_score)
  values (true, 8)
  on conflict (id) do nothing;

create table if not exists certification_attempts (
  id uuid primary key default gen_random_uuid(),
  analyst_id uuid not null references analysts(id),
  question_set smallint not null,
  total_questions integer not null,
  correct_count integer not null,
  passed boolean not null,
  answers jsonb not null, -- [{question_id, selected_index, correct}]
  attempted_at timestamptz not null default now()
);
create index if not exists idx_certification_attempts_analyst on certification_attempts(analyst_id);

alter table certification_questions enable row level security;
alter table certification_settings enable row level security;
alter table certification_attempts enable row level security;

-- Back office only, same posture as sales_items/commission_rules — the
-- self-service exam page reads/writes these through the admin client
-- (bypasses RLS) with an explicit analyst_id filter, not through the
-- caller's own RLS-scoped session (see listMyStaffPayslips() precedent for
-- why an explicit filter is required rather than relying on RLS alone).
drop policy if exists "back office only" on certification_questions;
create policy "back office only" on certification_questions for all
  using (is_back_office()) with check (is_back_office());

drop policy if exists "back office only" on certification_settings;
create policy "back office only" on certification_settings for all
  using (is_back_office()) with check (is_back_office());

drop policy if exists "back office only" on certification_attempts;
create policy "back office only" on certification_attempts for all
  using (is_back_office()) with check (is_back_office());
