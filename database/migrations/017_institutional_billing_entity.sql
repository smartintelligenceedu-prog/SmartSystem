-- ============================================================================
-- Migration 017 — Link institutional orders to a proper billing entity for
-- printable invoices/receipts.
--
-- The CTO brief for this asked for a new `institutions` table with
-- `ssm_number` and `billing_address` fields — but that table doesn't exist,
-- and the schema already has exactly this: `organizations` (party_id,
-- legal_name, registration_no — the SSM number — phone, email) and
-- `addresses` (line1/line2/city/state/postcode/country), both keyed off
-- `parties` and both already RLS-gated back-office-only. Reusing this
-- avoids a redundant parallel table and matches how every other "who is
-- this" relationship in the schema works (analysts/customers/introducers
-- all point at parties, never store identity fields directly).
--
-- orders.institution_party_id is nullable and only meaningful for
-- billing_mode = 'invoice' orders — it points at a parties row with
-- party_type = 'organization', which has one organizations row (legal
-- name + SSM number) and at least one addresses row (billing address).
-- ============================================================================

alter table orders add column if not exists institution_party_id uuid references parties(id);
create index if not exists idx_orders_institution_party on orders(institution_party_id);
