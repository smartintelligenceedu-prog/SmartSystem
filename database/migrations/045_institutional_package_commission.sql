-- Migration 045: optional fixed commission for a negotiated bulk package
-- deal (institutional_packages, migration 044) — mirrors PIC channel
-- campaigns' pic_report_override_amount / pic_analyst_report_fee_amount,
-- but institutional order_items have no customer/child_id (the "student
-- names" are just description text, not real customer records), so they
-- never flow through calculate_commissions_for_order()'s campaign lookup or
-- calculate_report_override_commission()'s report_delivered_at trigger —
-- those both require order_items.customer_id to resolve anything. Without
-- this, a package-linked institutional order's assigned analyst never
-- actually earned any commission; this migration is what wires that up.
--
-- responsible_analyst_id: who gets the flat report_override amount (the
-- deal's "owner"/leader, analogous to a campaign's pic_analyst_id) —
-- independent of which analyst is credited on any given batch order.
--
-- Fires per order_item on INSERT, not on the orders row — the app layer
-- inserts the order first and its order_items in a second, separate call,
-- so a trigger on orders would fire before any order_items exist yet.

alter table institutional_packages add column if not exists responsible_analyst_id uuid references analysts(id);
alter table institutional_packages add column if not exists report_override_amount numeric(12,2);
alter table institutional_packages add column if not exists analyst_report_fee_amount numeric(12,2);

create or replace function generate_institutional_package_commission_for_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_pkg institutional_packages%rowtype;
begin
  select * into v_order from orders where id = new.order_id;
  if not found or v_order.billing_mode <> 'invoice' or v_order.institutional_package_id is null then
    return new;
  end if;

  select * into v_pkg from institutional_packages where id = v_order.institutional_package_id;
  if not found then
    return new;
  end if;

  -- Idempotency guard, checked per-item (not per-order, since order_items
  -- for one order can be inserted across multiple separate statements).
  if exists (
    select 1 from commission_records
    where source_transaction_type = 'order_item'
      and source_transaction_id = new.id
      and trigger_type in ('report_override', 'analyst_report_fee')
  ) then
    return new;
  end if;

  if v_pkg.report_override_amount is not null and v_pkg.responsible_analyst_id is not null then
    perform insert_item_commission(
      'report_override', new.id, 1, v_pkg.responsible_analyst_id, null,
      'flat', null, v_pkg.report_override_amount, null, new.subtotal
    );
  end if;
  if v_pkg.analyst_report_fee_amount is not null and new.analyst_id is not null then
    perform insert_item_commission(
      'analyst_report_fee', new.id, 1, new.analyst_id, null,
      'flat', null, v_pkg.analyst_report_fee_amount, null, new.subtotal
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_generate_institutional_package_commission_for_item on order_items;
create trigger trg_generate_institutional_package_commission_for_item
  after insert on order_items
  for each row
  execute function generate_institutional_package_commission_for_item();
