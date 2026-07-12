-- ============================================================================
-- Migration 009 — Chart of Accounts seed + posting helper
--
-- Seeds the accounts needed for the Finance module's manual/periodic posting
-- flow (back office reviews unposted paid orders + commission_records and
-- posts them in a batch — not automatic per-transaction posting).
--
-- Posting policy (business decision, confirmed with the user):
--   - Every paid order posts gross revenue (Cash/Bank debit, Revenue credit),
--     INCLUDING voucher-redemption orders even though the customer paid the
--     analyst directly and no cash actually reached the company bank
--     account — the offsetting 100% commission expense on the same order
--     nets Net Profit to zero either way, and this keeps posting logic
--     uniform (no order needs special-casing).
--   - Every commission_record posts an expense accrual (Commission Expense
--     debit, Commission Payable credit) regardless of its payout status —
--     standard accrual accounting recognizes the expense once earned/owed,
--     not once actually paid out. There is no payout module yet, so nothing
--     ever debits Commission Payable back down; that is future scope.
--   - trigger_type has its own expense account (fine-grained, per the user's
--     choice) so back office can see which commission type costs the most.
-- ============================================================================

insert into chart_of_accounts (code, name, account_type) values
  ('1000', 'Cash / Bank', 'asset'),
  ('2000', 'Commission Payable', 'liability'),
  ('4000', 'Registration Fee Revenue', 'revenue'),
  ('4100', 'Detection Service Revenue', 'revenue'),
  ('5000', 'Commission Expense - Recruitment', 'expense'),
  ('5100', 'Commission Expense - Personal Sale', 'expense'),
  ('5200', 'Commission Expense - PIC Channel', 'expense'),
  ('5300', 'Commission Expense - Introducer', 'expense'),
  ('5400', 'Commission Expense - Voucher Resale', 'expense')
on conflict (code) do nothing;
