-- ============================================================================
-- Migration 010 — Report delivery status (no file storage)
--
-- Confirmed with the user: the system still never stores the report itself
-- (the detection device produces it, delivery happens over WhatsApp/email
-- outside this system — same "reports are never stored here" decision from
-- schema.sql's section 7 comment). This just adds a single nullable
-- timestamp so an analyst (or back office) can mark that a paid detection
-- service order's report has been handed to the customer, for their own
-- "My Reports" checklist. No new table needed for a single fact this small.
-- ============================================================================

alter table orders add column if not exists report_delivered_at timestamptz;
