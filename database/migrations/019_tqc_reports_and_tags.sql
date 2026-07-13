-- ============================================================================
-- Migration 019 — TQC brain-trait reports + auto-derived CRM child tags.
--
-- Phase 2 Task 2: a child can be assessed more than once over time (a
-- retest), so this is a new historical table (tqc_reports, one row per
-- assessment) rather than cramming a single mutable JSON blob onto
-- customer_children — the report page and tag derivation always operate on
-- the MOST RECENT row per child. Not linked to detection_sessions/
-- detection_appointments/devices — that subsystem exists in the schema but
-- has no code wired up to it yet, so linking there would be scope creep;
-- tqc_reports.child_id is the only relationship needed for this task.
--
-- customer_children.tags stores TAG KEYS ('math_talent', 'highly_sensitive',
-- ...), never bilingual display text — translation happens at the UI layer
-- via t(`tqc.tag.${key}`), same "never hardcode display text in data"
-- principle as everywhere else in this i18n convention.
--
-- Self-contained + fully idempotent (every create table/index/policy
-- guarded — see migration_idempotency_convention memory: this bit twice
-- before in this project, both mistakes fixed here from the start).
-- ============================================================================

alter table customer_children add column if not exists tags text[] not null default '{}';

create table if not exists tqc_reports (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references customer_children(id),
  recorded_at timestamptz not null default now(),
  created_by uuid references users(id),

  -- Eight multiple intelligences (Gardner), 0-100.
  intelligence_linguistic numeric(5,2) not null check (intelligence_linguistic between 0 and 100),
  intelligence_logical numeric(5,2) not null check (intelligence_logical between 0 and 100),
  intelligence_spatial numeric(5,2) not null check (intelligence_spatial between 0 and 100),
  intelligence_kinesthetic numeric(5,2) not null check (intelligence_kinesthetic between 0 and 100),
  intelligence_musical numeric(5,2) not null check (intelligence_musical between 0 and 100),
  intelligence_interpersonal numeric(5,2) not null check (intelligence_interpersonal between 0 and 100),
  intelligence_intrapersonal numeric(5,2) not null check (intelligence_intrapersonal between 0 and 100),
  intelligence_naturalistic numeric(5,2) not null check (intelligence_naturalistic between 0 and 100),

  -- Behavioral style — bipolar scales, one score per axis (0 = fully the
  -- "low" pole, 100 = fully the "high" pole).
  proactive_score numeric(5,2) not null check (proactive_score between 0 and 100), -- 0 passive .. 100 proactive
  sensitivity_score numeric(5,2) not null check (sensitivity_score between 0 and 100), -- 0 thick-skinned .. 100 highly sensitive

  -- Learning style — independent scores, not required to sum to 100 (a
  -- child can be strong in more than one).
  learning_style_visual numeric(5,2) not null check (learning_style_visual between 0 and 100),
  learning_style_auditory numeric(5,2) not null check (learning_style_auditory between 0 and 100),
  learning_style_kinesthetic numeric(5,2) not null check (learning_style_kinesthetic between 0 and 100),

  created_at timestamptz not null default now()
);
create index if not exists idx_tqc_reports_child on tqc_reports(child_id);

alter table tqc_reports enable row level security;

drop policy if exists "analyst reads own customers' children reports, back office reads all" on tqc_reports;
create policy "analyst reads own customers' children reports, back office reads all"
  on tqc_reports for select
  using (
    is_back_office()
    or exists (
      select 1 from customer_children cc
      join customers c on c.id = cc.customer_id
      where cc.id = tqc_reports.child_id and c.owner_analyst_id = current_analyst_id()
    )
    or exists (
      select 1 from customer_children cc
      join customers c on c.id = cc.customer_id
      where cc.id = tqc_reports.child_id and c.acquired_via_introducer_id = current_introducer_id()
    )
  );

-- Back-office-only at the RLS layer, same posture as customer_children
-- itself — the Server Action additionally allows the child's OWNING
-- analyst to write (front-line data entry), enforced in the app layer via
-- the admin client + its own permission check, same pattern as every other
-- mutation in this codebase (RLS is the conservative default, not the
-- primary gate for legitimate app-driven writes).
drop policy if exists "back office writes tqc reports" on tqc_reports;
create policy "back office writes tqc reports" on tqc_reports for insert with check (is_back_office());
drop policy if exists "back office updates tqc reports" on tqc_reports;
create policy "back office updates tqc reports" on tqc_reports for update using (is_back_office());

-- ----------------------------------------------------------------------------
-- Tag derivation: fires after a report is saved, recomputes
-- customer_children.tags from whichever report is currently the child's
-- most recent one. Thresholds: >80 for each of the 8 intelligence domains
-- (the exact number given for "Math Talent"), >75 / <25 for the bipolar
-- behavioral/learning-style axes (the exact number given for "Highly
-- Sensitive"), applied uniformly across sibling fields of the same shape —
-- not new invented figures. Tags are stored as keys, never display text.
-- ----------------------------------------------------------------------------

create or replace function derive_child_tags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tags text[] := '{}';
  v_latest_recorded_at timestamptz;
begin
  select max(recorded_at) into v_latest_recorded_at
  from tqc_reports
  where child_id = new.child_id;

  -- Only recompute tags if this save is (or ties) the most recent report for
  -- the child — editing/backfilling an older historical row should not
  -- override tags already derived from a newer assessment.
  if new.recorded_at < v_latest_recorded_at then
    return new;
  end if;

  if new.intelligence_linguistic > 80 then v_tags := array_append(v_tags, 'linguistic_talent'); end if;
  if new.intelligence_logical > 80 then v_tags := array_append(v_tags, 'math_talent'); end if;
  if new.intelligence_spatial > 80 then v_tags := array_append(v_tags, 'spatial_talent'); end if;
  if new.intelligence_kinesthetic > 80 then v_tags := array_append(v_tags, 'kinesthetic_talent'); end if;
  if new.intelligence_musical > 80 then v_tags := array_append(v_tags, 'musical_talent'); end if;
  if new.intelligence_interpersonal > 80 then v_tags := array_append(v_tags, 'interpersonal_talent'); end if;
  if new.intelligence_intrapersonal > 80 then v_tags := array_append(v_tags, 'intrapersonal_talent'); end if;
  if new.intelligence_naturalistic > 80 then v_tags := array_append(v_tags, 'naturalistic_talent'); end if;

  if new.sensitivity_score > 75 then v_tags := array_append(v_tags, 'highly_sensitive'); end if;
  if new.sensitivity_score < 25 then v_tags := array_append(v_tags, 'thick_skinned'); end if;

  if new.proactive_score > 75 then v_tags := array_append(v_tags, 'proactive'); end if;
  if new.proactive_score < 25 then v_tags := array_append(v_tags, 'passive'); end if;

  if new.learning_style_visual > 75 then v_tags := array_append(v_tags, 'visual_learner'); end if;
  if new.learning_style_auditory > 75 then v_tags := array_append(v_tags, 'auditory_learner'); end if;
  if new.learning_style_kinesthetic > 75 then v_tags := array_append(v_tags, 'kinesthetic_learner'); end if;

  update customer_children set tags = v_tags, updated_at = now() where id = new.child_id;

  return new;
end;
$$;

drop trigger if exists trg_derive_child_tags on tqc_reports;
create trigger trg_derive_child_tags
  after insert or update on tqc_reports
  for each row
  execute function derive_child_tags();
