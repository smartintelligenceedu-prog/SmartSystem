-- Lets back office record that an admin_fee statement (migration 072) has
-- actually been paid by the Leader/Consultant it was billed to, and issue
-- them a receipt for it.
--
-- Deliberately self-contained on staff_payslips rather than reusing the
-- real payments/receipts/journal_entries pipeline (finance_engine.sql) —
-- that pipeline posts customer-revenue journal entries on every payment
-- insert, which would be wrong here: an admin-fee collection is an internal
-- cost-sharing recovery, not customer revenue. receipt_no follows the same
-- 'RCP-YYYYMMDD-xxxxxx' format as the real receipts table purely for visual
-- consistency, generated in application code instead of a trigger.

alter table staff_payslips add column if not exists paid_at timestamptz;
alter table staff_payslips add column if not exists receipt_no text;
