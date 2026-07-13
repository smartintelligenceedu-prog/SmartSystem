-- ============================================================================
-- Migration 013 — Fix infinite RLS recursion between orders and order_items
--
-- Bug: migration 012 added a SELECT policy on `orders` that queries
-- `order_items` directly, and order_items already had a SELECT policy that
-- queries `orders` directly (both pre-existing and the migration 012
-- addition). Querying either table now evaluates a policy that queries the
-- other table, which evaluates a policy that queries the first table again
-- — Postgres correctly reports "infinite recursion detected in policy for
-- relation orders". Confirmed live: an analyst's own session got this error
-- on any orders/order_items select once migration 012 was applied.
--
-- Fix: same pattern already used throughout rls_policies.sql for exactly
-- this shape of problem (current_analyst_id(), is_back_office(), etc.) —
-- wrap the cross-table check in a SECURITY DEFINER function. Its internal
-- query runs as the bypassing owner role, so it does not re-trigger RLS
-- evaluation on order_items, which is what breaks the cycle.
-- ============================================================================

drop policy if exists "analyst reads orders containing their assigned items" on orders;

create or replace function analyst_has_item_in_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from order_items oi where oi.order_id = p_order_id and oi.analyst_id = current_analyst_id()
  )
$$;

revoke all on function analyst_has_item_in_order(uuid) from public;
grant execute on function analyst_has_item_in_order(uuid) to authenticated;

create policy "analyst reads orders containing their assigned items" on orders for select
  using (analyst_has_item_in_order(orders.id));
