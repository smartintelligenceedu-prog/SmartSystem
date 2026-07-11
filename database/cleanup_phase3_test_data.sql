-- ============================================================================
-- Phase 3 Portal test data cleanup
--
-- Removes every record created by the throwaway test-*@example.com accounts
-- used to verify the Agent/Leader/Introducer/Admin dashboards (test-admin,
-- test-leader2, test-agent2, test-introducer2, their customers, orders,
-- commission_records, etc). Keyed off the email pattern, not hardcoded IDs,
-- so it's safe to re-run and will also sweep up any earlier test-* accounts
-- left over from the Registration Module phase.
--
-- Run this in the Supabase SQL Editor AFTER confirming the dashboards are
-- verified and BEFORE committing Phase 3.
-- ============================================================================

do $$
declare
  test_party_ids uuid[];
  test_analyst_ids uuid[];
  test_introducer_ids uuid[];
  test_customer_ids uuid[];
  test_user_ids uuid[];
  test_reg_order_ids uuid[];
  test_order_ids uuid[];
begin
  select array_agg(party_id) into test_party_ids
  from individuals where email like 'test-%@example.com';

  if test_party_ids is null then
    raise notice 'No test-*@example.com individuals found — nothing to clean up.';
    return;
  end if;

  select array_agg(id) into test_analyst_ids from analysts where party_id = any(test_party_ids);
  select array_agg(id) into test_introducer_ids from introducers where party_id = any(test_party_ids);
  select array_agg(id) into test_customer_ids from customers where owner_analyst_id = any(test_analyst_ids);
  select array_agg(id) into test_user_ids from users where party_id = any(test_party_ids);
  select array_agg(id) into test_reg_order_ids from registration_orders where party_id = any(test_party_ids);

  select array_agg(id) into test_order_ids
  from orders
  where analyst_id = any(test_analyst_ids)
     or customer_id = any(test_customer_ids)
     or id in (select order_id from registration_orders where id = any(test_reg_order_ids));

  -- 1. Tables with no FK ordering constraints against each other (commission_records
  --    is intentionally not FK-constrained to its source transaction).
  delete from commission_records
  where analyst_id = any(test_analyst_ids)
     or introducer_id = any(test_introducer_ids)
     or source_transaction_id = any(test_order_ids);

  delete from business_card_orders
  where registration_order_id = any(test_reg_order_ids) or analyst_id = any(test_analyst_ids);

  delete from detection_vouchers
  where registration_order_id = any(test_reg_order_ids) or analyst_id = any(test_analyst_ids);

  delete from detection_sessions
  where analyst_id = any(test_analyst_ids) or customer_id = any(test_customer_ids);

  delete from detection_appointments
  where analyst_id = any(test_analyst_ids) or customer_id = any(test_customer_ids);

  delete from leads
  where assigned_analyst_id = any(test_analyst_ids) or converted_customer_id = any(test_customer_ids);

  delete from interactions
  where analyst_id = any(test_analyst_ids) or customer_id = any(test_customer_ids);

  delete from customer_consents where customer_id = any(test_customer_ids);
  delete from customer_ownership_history where customer_id = any(test_customer_ids);

  -- 2. order_items (child of orders) before orders.
  delete from order_items where order_id = any(test_order_ids);

  -- 3. Break analysts -> registration_orders FK before deleting registration_orders.
  update analysts set registration_order_id = null where id = any(test_analyst_ids);

  -- 4. registration_orders (child of orders, parent of analysts.registration_order_id — now nulled).
  delete from registration_orders where id = any(test_reg_order_ids);

  -- 5. orders (now childless).
  delete from orders where id = any(test_order_ids);

  -- 6. channel_campaigns (child of analysts) before analysts.
  delete from channel_campaigns where pic_analyst_id = any(test_analyst_ids);

  -- 7. customers (child of analysts) before analysts.
  delete from customers where id = any(test_customer_ids);

  -- 8. analysts / introducers (now childless).
  delete from analysts where id = any(test_analyst_ids);
  delete from introducers where id = any(test_introducer_ids);

  -- 9. Identity tables.
  delete from user_roles where user_id = any(test_user_ids);
  delete from users where id = any(test_user_ids);
  delete from individuals where party_id = any(test_party_ids);
  delete from parties where id = any(test_party_ids);

  raise notice 'Cleaned up % parties, % analysts, % introducers, % customers, % orders, % registration_orders',
    coalesce(array_length(test_party_ids, 1), 0),
    coalesce(array_length(test_analyst_ids, 1), 0),
    coalesce(array_length(test_introducer_ids, 1), 0),
    coalesce(array_length(test_customer_ids, 1), 0),
    coalesce(array_length(test_order_ids, 1), 0),
    coalesce(array_length(test_reg_order_ids, 1), 0);
end $$;

-- ---- Auth accounts (run separately if the block above succeeds) ----
-- Supabase SQL Editor runs with a role that can see the auth schema; deleting
-- here cascades to auth.identities/sessions. If this errors under your
-- project's permissions, delete the same test-*@example.com accounts via
-- Supabase Dashboard -> Authentication -> Users instead.
delete from auth.users where email like 'test-%@example.com';
