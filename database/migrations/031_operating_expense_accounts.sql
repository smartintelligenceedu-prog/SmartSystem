-- ============================================================================
-- Migration 031 — Operating expense accounts for manual company spending
-- (2026-07-15, CTO request): software subscriptions (e.g. Claude), office
-- supplies, and general one-off company spending had nowhere to be recorded
-- — every journal_entries row until now was auto-derived from a paid order
-- or a commission_record. This just adds the chart-of-accounts rows; the
-- manual-entry Server Action lives in
-- web/src/app/admin/(protected)/finance/actions.ts (recordOperatingExpense).
--
-- Self-contained + idempotent: on conflict do nothing is always safe to rerun.
-- ============================================================================

insert into chart_of_accounts (code, name, account_type) values
  ('6000', 'Operating Expense - Software & Subscriptions', 'expense'),
  ('6100', 'Operating Expense - Office & General', 'expense'),
  ('6900', 'Operating Expense - Other', 'expense')
on conflict (code) do nothing;
