-- ============================================================================
-- TQC Business Management System — TQC One-Page Report Tag Engine (v1.0)
-- Apply after schema.sql + rls_policies.sql.
-- Replaces tqc_report_engine.sql (the abandoned radar-chart approach).
--
-- Derives customer_children.tags from a child's most recent
-- tqc_one_page_reports row the moment it's saved — same "trigger fired by
-- a single INSERT, atomic with the row that caused it" philosophy as
-- commission_engine.sql/finance_engine.sql. Tags are stored as KEYS
-- ('owl_smart', 'learning_visual', ...), never bilingual display text —
-- translated at the UI layer via t(`tqc.tag.${key}`).
--
-- Narrower than the old engine: only personality_type and learning_styles
-- derive tags now (no brain-zone-score thresholds — that was specific to
-- the abandoned 8-intelligence model).
-- ============================================================================

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

  -- Only recompute tags if this save is (or ties) the most recent report
  -- for the child — editing/backfilling an older historical row should not
  -- override tags already derived from a newer assessment.
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
