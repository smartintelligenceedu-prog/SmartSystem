-- Institutional package deposits currently have zero financial-system
-- integration: institutional_packages.deposit_amount/deposit_received_at are
-- pure informational fields, so accounting has no payment/receipt/ledger
-- artifact to actually collect the money against.
--
-- Fix: reuse the EXISTING institutional order + payment + receipt + ledger
-- pipeline (orders/order_items/payments/handle_payment_recorded(), all
-- unchanged) instead of building a parallel one. A package with a deposit_amount
-- gets a "shell" order — same institution, item_type 'other' (never counted
-- as a detection-session credit anywhere), institutional_package_id left NULL
-- (so it never pollutes that package's used_credits sum) but linked back via
-- the new deposit_for_package_id column. It starts in the normal 'no_invoice'
-- state, so back office records the deposit through the exact same
-- "登记定金" button/flow already used for every other institutional order —
-- which is what actually inserts the payments row, fires
-- handle_payment_recorded(), and produces a real receipt + journal entries.
--
-- deposit_received_at is repurposed to mean "the shell order's deposit
-- payment was actually recorded", not "someone typed a deposit_amount" —
-- recordPayment() (web/src/app/admin/(protected)/finance/institutional/actions.ts)
-- now stamps it at that point instead of at package-creation time.

alter table orders add column if not exists deposit_for_package_id uuid references institutional_packages(id);
create index if not exists idx_orders_deposit_for_package on orders(deposit_for_package_id);

-- One-time backfill: packages created before this migration already have
-- deposit_amount set (and deposit_received_at eagerly stamped at creation,
-- before this fix existed) but no shell order at all. Idempotent — only
-- acts on packages that don't already have one, so re-running this migration
-- never creates duplicates. Resets deposit_received_at to null for those
-- packages since no real payment has actually been recorded yet; back office
-- records it the same way as any other order once this migration runs.
do $$
declare
  v_pkg record;
  v_order_id uuid;
begin
  for v_pkg in
    select id, institution_party_id, name, deposit_amount, responsible_analyst_id
    from institutional_packages
    where deposit_amount is not null
      and id not in (select deposit_for_package_id from orders where deposit_for_package_id is not null)
  loop
    insert into orders (order_type, status, billing_mode, total_amount, institution_party_id, deposit_for_package_id)
    values ('detection_service', 'pending', 'invoice', v_pkg.deposit_amount, v_pkg.institution_party_id, v_pkg.id)
    returning id into v_order_id;

    insert into order_items (order_id, item_type, description, unit_price, quantity, subtotal, analyst_id)
    values (v_order_id, 'other', '套餐定金 - ' || v_pkg.name, v_pkg.deposit_amount, 1, v_pkg.deposit_amount, v_pkg.responsible_analyst_id);

    update institutional_packages set deposit_received_at = null where id = v_pkg.id;
  end loop;
end $$;
