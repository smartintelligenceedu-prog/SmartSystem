-- ============================================================================
-- Migration 037 — remove the star-rating field from the TQC report
-- (2026-07-17, CTO request): tqc_stars is no longer collected on the entry
-- form or shown on the report. Column kept (nullable now, was not null) so
-- existing reports' star data isn't destroyed — just stops being required
-- for new ones. The 0-5 check constraint already allows NULL with no
-- change needed (Postgres check constraints don't fire on NULL).
--
-- Self-contained + idempotent: safe to rerun (dropping a constraint that's
-- already dropped is a no-op via the do-block's existence check).
-- ============================================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'tqc_one_page_reports' and column_name = 'tqc_stars' and is_nullable = 'NO'
  ) then
    alter table tqc_one_page_reports alter column tqc_stars drop not null;
  end if;
end $$;
