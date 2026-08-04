-- ============================================================================
-- Migration 068 — Expected deposit amount on institutional/invoice orders
--
-- Back office previously had nowhere to record what deposit a standalone
-- order (institution- or individual-customer-billed) is supposed to collect
-- until the moment they actually recorded it via "登记定金" — there was no
-- planned figure to follow up against. This is purely a follow-up hint: the
-- actual accounting effect still only happens when a real payments row is
-- inserted (handle_payment_recorded() in finance_engine.sql), unchanged.
-- ============================================================================

alter table orders add column if not exists expected_deposit_amount numeric(12,2);
