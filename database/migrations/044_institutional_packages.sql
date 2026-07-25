-- Migration 044: negotiated bulk "package" deals for an institution — e.g.
-- a school agrees to a 100-credit package at a set unit price, pays a small
-- deposit (often ~10%) upfront, then is invoiced individually per batch as
-- students actually get tested (NOT one lump-sum payment for all 100 up
-- front). This is deliberately separate from institutional_vouchers
-- (migration 018), which requires the WHOLE order to be paid before any
-- voucher exists — that model doesn't fit a deposit-only / pay-per-batch
-- arrangement. Here, "remaining credits" is derived by summing order_items
-- across every non-cancelled order linked to the package, not pre-issued
-- vouchers, so it stays correct as batches get invoiced over time
-- regardless of payment status on any individual batch.
create table if not exists institutional_packages (
  id uuid primary key default gen_random_uuid(),
  institution_party_id uuid not null references parties(id),
  name text not null,
  total_credits int not null check (total_credits > 0),
  unit_price numeric(12,2) not null check (unit_price > 0),
  -- Optional record of the upfront deposit collected for this package deal
  -- — informational only (no ledger effect of its own); the ledger entries
  -- still come from each batch's own invoice/payment as usual.
  deposit_amount numeric(12,2),
  deposit_received_at timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists idx_institutional_packages_institution on institutional_packages(institution_party_id);

-- Same posture as institutional_vouchers (migration 018) — back office
-- manages these directly; front-line agents only ever see derived
-- used/remaining counts through the Institutional Orders pages, never this
-- table itself.
alter table institutional_packages enable row level security;
drop policy if exists "back office only" on institutional_packages;
create policy "back office only" on institutional_packages for all using (is_back_office()) with check (is_back_office());

alter table orders add column if not exists institutional_package_id uuid references institutional_packages(id);
create index if not exists idx_orders_institutional_package on orders(institutional_package_id);
