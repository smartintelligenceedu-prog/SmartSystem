-- ============================================================================
-- Migration 030 — Missing chart-of-accounts entries for report_override /
-- analyst_report_fee commissions (2026-07-15, discovered while testing the
-- new selective "过帐" checkbox flow).
--
-- Migration 009 seeded one expense account per commission trigger_type, but
-- report_override (migration 015) and analyst_report_fee (migration 025)
-- were both added afterward without a matching account. postToLedger() in
-- web/src/app/admin/(protected)/finance/actions.ts silently skips any
-- commission_record whose trigger_type has no account mapping — so these two
-- types have never been posted to the ledger, meaning Net Profit on
-- /admin/finance has been overstated by their sum ever since. This just adds
-- the missing accounts; the app-code account map is updated separately.
--
-- Self-contained + idempotent: on conflict do nothing is always safe to rerun.
-- ============================================================================

insert into chart_of_accounts (code, name, account_type) values
  ('5500', 'Commission Expense - Report Override', 'expense'),
  ('5700', 'Commission Expense - Analyst Report Fee', 'expense')
on conflict (code) do nothing;
