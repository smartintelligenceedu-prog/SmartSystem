-- ============================================================================
-- TQC Business Management System — Certification Unlock Engine (v1.0)
-- Apply after schema.sql + rls_policies.sql (migration 021).
--
-- Minimal TRN-02 patch: no training-course/exam tracking exists yet, so
-- certification is recorded as a single manual admin action (analysts.
-- certification_passed_at). This trigger unlocks the analyst's locked
-- resale detection_voucher (from the 688 registration kit) the instant that
-- flag is set — same "commits atomically with the row that caused it"
-- philosophy as commission_engine.sql / finance_engine.sql / the TQC report
-- tag-derivation trigger, so the unlock can never happen out of step with
-- the certification flag regardless of what path updates analysts.
-- ============================================================================

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
