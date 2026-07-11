-- ============================================================================
-- Migration 008 — Sales Orders payment review side-table
--
-- New table: sales_orders. Mirrors how registration_orders is the
-- type-specific side-table for order_type = 'registration' orders — orders
-- itself stays generic (no order-type-specific columns added there).
--
-- Only created for the "customer pays now, screenshot + back-office review"
-- path. Voucher-redemption sales orders never get a row here: the customer
-- already paid the analyst directly for a resold voucher, so there is
-- nothing for back office to verify — that path goes straight to
-- orders.status = 'paid'.
-- ============================================================================

create table sales_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  payment_screenshot_url text not null,
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
create index idx_sales_orders_order on sales_orders(order_id);

alter table sales_orders enable row level security;
create policy "back office only" on sales_orders for all using (is_back_office()) with check (is_back_office());
