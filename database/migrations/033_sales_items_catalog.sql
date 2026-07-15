-- ============================================================================
-- Migration 033 — Sales item / price catalog (2026-07-15, CTO request):
-- consumer sales orders (web/src/app/admin/(protected)/sales-orders) had no
-- price list at all — whoever created an order just typed a free-text
-- amount ("confirm what was actually received"), same as a discount is now
-- just a second line with a negative amount, not a % applied to the order.
--
-- item_kind distinguishes normal priced items ('item', e.g. "Standard
-- Report") from discount/promo lines ('discount', typically a negative
-- price). The order-creation action maps 'item' -> order_items.item_type
-- 'detection_session' (unchanged commission behavior) and 'discount' ->
-- 'other', which the commission engine already excludes from every payout
-- path (see the item_type filters in commission_engine.sql) — so a discount
-- line reduces order revenue/what the customer paid without reducing
-- analyst commission. No commission_engine.sql change was needed for this.
--
-- Self-contained + idempotent: every statement guarded, safe to rerun.
-- ============================================================================

create table if not exists sales_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(12,2) not null,
  item_kind text not null default 'item' check (item_kind in ('item', 'discount')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sales_items_active on sales_items(is_active);

alter table sales_items enable row level security;

-- Back-office only, same as commission_rules/chart_of_accounts and every
-- other internal reference table — analyst-facing pages read this through
-- the admin client (bypasses RLS), matching listOwnCustomersForPicker() and
-- every other lookup listSalesOrders/new/page.tsx already uses.
drop policy if exists "back office only" on sales_items;
create policy "back office only" on sales_items for all using (is_back_office()) with check (is_back_office());
