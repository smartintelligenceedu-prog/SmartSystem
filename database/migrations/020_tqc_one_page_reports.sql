-- ============================================================================
-- Migration 020 — TQC one-page (A4 golden-layout) brain report, replacing
-- the generic radar-chart approach from migration 019.
--
-- Numbered 020, not 019 as the brief specified — 019 was already used and
-- applied for the (now abandoned) tqc_reports/radar system.
--
-- Column naming note: the brief's brain zone columns were named with
-- uppercase A-E and lowercase a-e (e.g. brain_zone_A vs brain_zone_a) as if
-- they were 10 distinct columns. Postgres folds unquoted identifiers to
-- lowercase, so `brain_zone_A` and `brain_zone_a` are the SAME column name
-- — this would have failed with a duplicate-column error at CREATE TABLE
-- time. Renamed all ten to fully distinct, descriptive names (a-j
-- sequentially), preserving the original letter order 1:1:
--   brain_zone_a_organization  (was A, 组织管理)
--   brain_zone_b_logic         (was B, 逻辑推理)
--   brain_zone_c_motor         (was C, 动手操作)
--   brain_zone_d_language      (was D, 语文记忆)
--   brain_zone_e_reading       (was E, 辨识阅读)
--   brain_zone_f_creativity    (was a, 创新思维)
--   brain_zone_g_spatial       (was b, 空间感知)
--   brain_zone_h_artistic      (was c, 艺术体觉)
--   brain_zone_i_emotion       (was d, 声音情感)
--   brain_zone_j_visual        (was e, 图像认知)
--
-- personality_type is plain text (not a checked enum) — only 'owl_smart'
-- has real, user-confirmed content right now; the full animal/archetype
-- list is still pending from the user, so the schema doesn't hard-block on
-- an incomplete enum. Tighten to a check constraint once the full list is
-- confirmed.
--
-- Self-contained + fully idempotent (every statement guarded — see
-- migration_idempotency_convention memory).
-- ============================================================================

-- The old radar-based system (migration 019) is abandoned per explicit
-- instruction — drop its trigger/function/table. No real production data
-- was ever left in tqc_reports (every test cycle this project cleaned up
-- after itself), so this is safe.
drop trigger if exists trg_derive_child_tags on tqc_reports;
drop function if exists derive_child_tags();
drop table if exists tqc_reports;

create table if not exists tqc_one_page_reports (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references customer_children(id),
  created_by_analyst_id uuid references analysts(id),
  recorded_at timestamptz not null default now(),

  left_brain_pct numeric(5,2) not null check (left_brain_pct between 0 and 100),
  right_brain_pct numeric(5,2) not null check (right_brain_pct between 0 and 100),

  brain_zone_a_organization numeric(5,2) not null check (brain_zone_a_organization between 0 and 100),
  brain_zone_b_logic numeric(5,2) not null check (brain_zone_b_logic between 0 and 100),
  brain_zone_c_motor numeric(5,2) not null check (brain_zone_c_motor between 0 and 100),
  brain_zone_d_language numeric(5,2) not null check (brain_zone_d_language between 0 and 100),
  brain_zone_e_reading numeric(5,2) not null check (brain_zone_e_reading between 0 and 100),
  brain_zone_f_creativity numeric(5,2) not null check (brain_zone_f_creativity between 0 and 100),
  brain_zone_g_spatial numeric(5,2) not null check (brain_zone_g_spatial between 0 and 100),
  brain_zone_h_artistic numeric(5,2) not null check (brain_zone_h_artistic between 0 and 100),
  brain_zone_i_emotion numeric(5,2) not null check (brain_zone_i_emotion between 0 and 100),
  brain_zone_j_visual numeric(5,2) not null check (brain_zone_j_visual between 0 and 100),

  personality_type text not null,

  tqc_activity_score numeric(6,2) not null check (tqc_activity_score >= 0),
  tqc_stars int not null check (tqc_stars between 0 and 5),

  -- 'motivation' | 'thinking' | 'tactile' | 'auditory' | 'visual' — the five
  -- "effective learning style" checkboxes from the brief. Not enforced by a
  -- check constraint since it's an array; validated in the Server Action.
  learning_styles text[] not null default '{}',

  analyst_summary text,

  created_at timestamptz not null default now()
);
create index if not exists idx_tqc_one_page_reports_child on tqc_one_page_reports(child_id);

alter table tqc_one_page_reports enable row level security;

drop policy if exists "analyst reads own customers' children one-page reports, back office reads all" on tqc_one_page_reports;
create policy "analyst reads own customers' children one-page reports, back office reads all"
  on tqc_one_page_reports for select
  using (
    is_back_office()
    or exists (
      select 1 from customer_children cc
      join customers c on c.id = cc.customer_id
      where cc.id = tqc_one_page_reports.child_id and c.owner_analyst_id = current_analyst_id()
    )
    or exists (
      select 1 from customer_children cc
      join customers c on c.id = cc.customer_id
      where cc.id = tqc_one_page_reports.child_id and c.acquired_via_introducer_id = current_introducer_id()
    )
  );

drop policy if exists "back office writes tqc one-page reports" on tqc_one_page_reports;
create policy "back office writes tqc one-page reports" on tqc_one_page_reports for insert with check (is_back_office());
drop policy if exists "back office updates tqc one-page reports" on tqc_one_page_reports;
create policy "back office updates tqc one-page reports" on tqc_one_page_reports for update using (is_back_office());

-- ----------------------------------------------------------------------------
-- Tag derivation — same trigger philosophy as everywhere else in this
-- project. Per the new (narrower) spec, only personality_type and
-- learning_styles derive tags now (no brain-zone-score thresholds this
-- time — that was specific to the abandoned 8-intelligence model).
-- ----------------------------------------------------------------------------

create or replace function derive_child_tags_one_page()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tags text[] := '{}';
  v_latest_recorded_at timestamptz;
  v_style text;
begin
  select max(recorded_at) into v_latest_recorded_at
  from tqc_one_page_reports
  where child_id = new.child_id;

  if new.recorded_at < v_latest_recorded_at then
    return new;
  end if;

  v_tags := array_append(v_tags, new.personality_type);

  foreach v_style in array new.learning_styles loop
    v_tags := array_append(v_tags, 'learning_' || v_style);
  end loop;

  update customer_children set tags = v_tags, updated_at = now() where id = new.child_id;

  return new;
end;
$$;

drop trigger if exists trg_derive_child_tags_one_page on tqc_one_page_reports;
create trigger trg_derive_child_tags_one_page
  after insert or update on tqc_one_page_reports
  for each row
  execute function derive_child_tags_one_page();
