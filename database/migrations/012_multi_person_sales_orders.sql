-- ============================================================================
-- Migration 012 — Multi-person Sales Orders (e.g. a family visiting together)
--
-- One detection_service order can now cover several people in one payment:
-- each order_item gets its own customer_id (who this line is for) and
-- analyst_id (which agent is credited for that person), instead of the
-- whole order pointing at one customer/analyst. orders.customer_id /
-- orders.analyst_id are unchanged in meaning — analyst_id stays "who
-- submitted this order" (needed for the existing self-scope RLS policy),
-- customer_id stays unused for detection_service orders (same as today).
--
-- Commission calculation moves from "once per order" to "once per item":
-- insert_item_commission() is a NEW function, source_transaction_type =
-- 'order_item' (source_transaction_id = order_items.id) — this is additive,
-- the existing insert_commission() function (source_transaction_type =
-- 'order') is completely untouched and still used by the registration
-- branch of calculate_commissions_for_order(), which is not modified at all
-- in this migration.
-- ============================================================================

alter table order_items add column if not exists customer_id uuid references customers(id);
alter table order_items add column if not exists analyst_id uuid references analysts(id);
create index if not exists idx_order_items_customer on order_items(customer_id);
create index if not exists idx_order_items_analyst on order_items(analyst_id);

-- Agents can also see order_items assigned to them even when they didn't
-- submit the order (a different family member's item may be credited to a
-- different agent than whoever processed the payment).
create policy "analyst reads own assigned order items" on order_items for select
  using (analyst_id = current_analyst_id());

create policy "analyst reads orders containing their assigned items" on orders for select
  using (exists (select 1 from order_items oi where oi.order_id = orders.id and oi.analyst_id = current_analyst_id()));

-- ----------------------------------------------------------------------------
-- New: per-item commission insert helper. Mirrors insert_commission() exactly
-- except source_transaction_type is 'order_item' (pointing at order_items.id)
-- instead of 'order' — this is what makes it possible to trace which
-- specific person's commission a record belongs to when several people
-- share one order.
-- ----------------------------------------------------------------------------

create or replace function insert_item_commission(
  p_trigger_type text,
  p_order_item_id uuid,
  p_level int,
  p_analyst_id uuid,
  p_introducer_id uuid,
  p_calculation_type text,
  p_rate numeric,
  p_flat_amount numeric,
  p_cap numeric,
  p_base numeric
)
returns void
language plpgsql
as $$
declare
  v_amount numeric;
begin
  if p_calculation_type = 'flat' then
    v_amount := p_flat_amount;
  else
    v_amount := round(p_base * p_rate / 100, 2);
  end if;

  if p_cap is not null and v_amount > p_cap then
    v_amount := p_cap;
  end if;

  insert into commission_records (
    trigger_type, source_transaction_type, source_transaction_id,
    level_number, analyst_id, introducer_id, calculation_type, rate_applied, base_amount, commission_amount
  ) values (
    p_trigger_type, 'order_item', p_order_item_id,
    p_level, p_analyst_id, p_introducer_id, p_calculation_type,
    case when p_calculation_type = 'flat' then null else p_rate end,
    p_base, v_amount
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Rewrite calculate_commissions_for_order(): the registration branch below
-- is byte-for-byte identical to the version in commission_engine.sql /
-- migration 006 — only the detection_service branch changes, from operating
-- once on the whole order to looping every order_item.
-- ----------------------------------------------------------------------------

create or replace function calculate_commissions_for_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg_order registration_orders%rowtype;
  v_new_analyst_id uuid;
  v_sponsor uuid;
  v_rule record;
  v_campaign_id uuid;
  v_pic_analyst_id uuid;
  v_introducer_id uuid;
  v_item order_items%rowtype;
  i int;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'paid' then
      return new;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.status <> 'paid' or old.status = 'paid' then
      return new;
    end if;
  end if;

  -- ---- Registration order: 3-level recruitment commission (unchanged) ----
  if new.order_type = 'registration' then
    select * into v_reg_order from registration_orders where order_id = new.id;
    if not found or v_reg_order.sponsor_id is null then
      return new;
    end if;

    select id into v_new_analyst_id from analysts where registration_order_id = v_reg_order.id;
    if v_new_analyst_id is null then
      return new;
    end if;

    for i in 1..3 loop
      v_sponsor := sponsor_at_level(v_new_analyst_id, i);
      exit when v_sponsor is null;
      select * into v_rule from get_active_rule('recruitment', i);
      if v_rule.calculation_type is not null then
        perform insert_commission(
          'recruitment', new.id, i, v_sponsor, null,
          v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, new.total_amount
        );
      end if;
    end loop;

    return new;
  end if;

  -- ---- Detection service order: one commission pass per order_item ----
  if new.order_type <> 'detection_service' then
    return new;
  end if;

  for v_item in
    select * from order_items
    where order_id = new.id and item_type in ('detection_session', 'voucher_redemption')
  loop
    if v_item.analyst_id is null then
      continue; -- no agent assigned to this person's line item, nothing to pay
    end if;

    -- Voucher redemption is terminal: 100% to the redeeming analyst, no cascade.
    if v_item.item_type = 'voucher_redemption' then
      select * into v_rule from get_active_rule('voucher_resale', 0);
      if v_rule.calculation_type is null then
        perform insert_item_commission('voucher_resale', v_item.id, 0, v_item.analyst_id, null, 'percentage', 100, null, null, v_item.subtotal);
      else
        perform insert_item_commission(
          'voucher_resale', v_item.id, 0, v_item.analyst_id, null,
          v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, v_item.subtotal
        );
      end if;
      continue;
    end if;

    v_campaign_id := null;
    v_introducer_id := null;
    if v_item.customer_id is not null then
      select acquired_via_campaign_id, acquired_via_introducer_id
        into v_campaign_id, v_introducer_id
      from customers where id = v_item.customer_id;
    end if;

    -- Personal sale vs. PIC channel sale are mutually exclusive per item.
    if v_campaign_id is not null then
      select pic_analyst_id into v_pic_analyst_id from channel_campaigns where id = v_campaign_id;
      select * into v_rule from get_active_rule('pic_channel', 1);
      if v_pic_analyst_id is not null and v_rule.calculation_type is not null then
        perform insert_item_commission(
          'pic_channel', v_item.id, 1, v_pic_analyst_id, null,
          v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, v_item.subtotal
        );
      end if;
    else
      v_sponsor := sponsor_at_level(v_item.analyst_id, 1);
      select * into v_rule from get_active_rule('personal_sale', 1);
      if v_sponsor is not null and v_rule.calculation_type is not null then
        perform insert_item_commission(
          'personal_sale', v_item.id, 1, v_sponsor, null,
          v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, v_item.subtotal
        );
      end if;
    end if;

    -- Introducer referral fee stacks on top of whichever rule fired above.
    if v_introducer_id is not null then
      select * into v_rule from get_active_rule('introducer', 1);
      if v_rule.calculation_type is not null then
        perform insert_item_commission(
          'introducer', v_item.id, 1, null, v_introducer_id,
          v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, v_item.subtotal
        );
      end if;
    end if;
  end loop;

  return new;
end;
$$;
