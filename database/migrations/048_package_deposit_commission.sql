-- A negotiated package's deposit (migration 046) had no commission of its
-- own — only the per-credit report_override_amount/analyst_report_fee_amount
-- (migration 045) paid out, and only when a batch order was later invoiced.
-- Some deals pay the responsible analyst a flat cut of the deposit itself
-- (e.g. "10% deposit, 50% of that to the responsible person") — this adds an
-- optional deposit_commission_amount, paid out the moment the deposit
-- payment is actually recorded (not at package creation, matching this
-- project's existing deposit-received_at semantics from migration 046).
--
-- Fires on payments insert (not order_items) since that's the event that
-- makes a deposit "real" — coexists with the existing trg_payment_recorded
-- trigger on the same table/event (Postgres runs multiple triggers on one
-- table/event independently, same pattern documented in migration 018).

alter table institutional_packages add column if not exists deposit_commission_amount numeric(12,2);

alter table commission_records drop constraint if exists commission_records_trigger_type_check;
alter table commission_records add constraint commission_records_trigger_type_check check (
  trigger_type in ('personal_sale', 'pic_channel', 'introducer', 'recruitment', 'voucher_resale', 'report_override', 'analyst_report_fee', 'package_deposit_commission')
);

create or replace function generate_institutional_package_deposit_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_pkg institutional_packages%rowtype;
  v_item order_items%rowtype;
begin
  if new.payment_type <> 'deposit' then
    return new;
  end if;

  select * into v_order from orders where id = new.order_id;
  if not found or v_order.deposit_for_package_id is null then
    return new;
  end if;

  select * into v_pkg from institutional_packages where id = v_order.deposit_for_package_id;
  if not found or v_pkg.deposit_commission_amount is null or v_pkg.responsible_analyst_id is null then
    return new;
  end if;

  -- The deposit shell order has exactly one order_item (its 'other'-type
  -- deposit line, migration 046) — that's the source_transaction_id this
  -- commission is keyed on, same convention as every other item-level
  -- commission in this engine.
  select * into v_item from order_items where order_id = new.order_id limit 1;
  if not found then
    return new;
  end if;

  if exists (
    select 1 from commission_records
    where source_transaction_type = 'order_item'
      and source_transaction_id = v_item.id
      and trigger_type = 'package_deposit_commission'
  ) then
    return new;
  end if;

  perform insert_item_commission(
    'package_deposit_commission', v_item.id, 1, v_pkg.responsible_analyst_id, null,
    'flat', null, v_pkg.deposit_commission_amount, null, new.amount
  );

  return new;
end;
$$;

drop trigger if exists trg_generate_institutional_package_deposit_commission on payments;
create trigger trg_generate_institutional_package_deposit_commission
  after insert on payments
  for each row
  execute function generate_institutional_package_deposit_commission();
