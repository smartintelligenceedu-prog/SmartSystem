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
--
-- v1.1 (migration 028): the subject can now be a customer_children row OR
-- the customer themselves directly (adult self-assessment) — exactly one of
-- child_id/customer_id is set (chk_tqc_report_subject), and tags land on
-- whichever one applies.
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
  if new.child_id is not null then
    select max(recorded_at) into v_latest_recorded_at
    from tqc_one_page_reports
    where child_id = new.child_id;
  else
    select max(recorded_at) into v_latest_recorded_at
    from tqc_one_page_reports
    where customer_id = new.customer_id;
  end if;

  -- Only recompute tags if this save is (or ties) the most recent report
  -- for the subject — editing/backfilling an older historical row should
  -- not override tags already derived from a newer assessment.
  if new.recorded_at < v_latest_recorded_at then
    return new;
  end if;

  v_tags := array_append(v_tags, new.personality_type);

  foreach v_style in array new.learning_styles loop
    v_tags := array_append(v_tags, 'learning_' || v_style);
  end loop;

  if new.child_id is not null then
    update customer_children set tags = v_tags, updated_at = now() where id = new.child_id;
  else
    update customers set tags = v_tags, updated_at = now() where id = new.customer_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_derive_child_tags_one_page on tqc_one_page_reports;
create trigger trg_derive_child_tags_one_page
  after insert or update on tqc_one_page_reports
  for each row
  execute function derive_child_tags_one_page();
