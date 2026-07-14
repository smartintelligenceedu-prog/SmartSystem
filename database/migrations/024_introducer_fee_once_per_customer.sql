-- ============================================================================
-- Migration 024 — Introducer referral fee becomes a one-time-per-customer
-- event instead of firing on every order_item / every order.
--
-- Previously calculate_commissions_for_order() paid the introducer commission
-- inside the per-order_item loop, once per detection_session item. A family
-- bringing 2 children in one order therefore generated 2 separate introducer
-- fees, and a returning customer's later orders would keep paying the
-- introducer again and again. The CTO flagged this after reviewing live demo
-- data on 2026-07-14 — a referral fee should reward the introduction once,
-- not scale with how many sessions/orders that family ever buys.
--
-- New behavior: introducer commission is calculated once per order (grouped
-- by customer_id, summing that customer's detection_session item subtotals
-- in THIS order), and only fires at all if this is the customer's first-ever
-- paid detection_service order. Later orders for the same customer never pay
-- an introducer fee again, no matter how many more children/sessions they add.
--
-- Self-contained + idempotent: `create or replace function` is safe to rerun.
-- No table/column changes, so no guards needed beyond that.
-- ============================================================================

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
  v_intro_payee uuid;
  v_item order_items%rowtype;
  v_intro_row record;
  i int;
  j int;
begin
  -- Only fire on the pending/other -> paid transition, and only once.
  -- OLD is not a valid record on INSERT, so it must never be referenced in
  -- that branch — check tg_op first rather than folding it into one boolean
  -- expression, since Postgres does not guarantee AND/OR short-circuit order.
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
      return new; -- no sponsor to pay (e.g. house-recruited analyst)
    end if;

    select id into v_new_analyst_id from analysts where registration_order_id = v_reg_order.id;
    if v_new_analyst_id is null then
      return new; -- analyst record not created yet; nothing to walk up from
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
        -- fall back to the "100% to self" default if nobody has configured this rule yet
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
    if v_item.customer_id is not null then
      select acquired_via_campaign_id into v_campaign_id
      from customers where id = v_item.customer_id;
    end if;

    -- Personal sale vs. PIC channel sale are mutually exclusive per item.
    -- v1.3 (migration 015): PIC-channel items no longer get a commission at
    -- sale time at all — that payout moved to report-delivery time instead.
    if v_campaign_id is not null then
      null; -- intentionally no sale-time commission for PIC-channel items
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
  end loop;

  -- ----------------------------------------------------------------------
  -- Introducer referral fee (migration 024) — ONE-TIME per customer, paid
  -- only on that customer's first-ever paid detection_service order, never
  -- again on later orders no matter how many more children/sessions they
  -- bring. Base amount = sum of THIS (first) order's detection_session item
  -- subtotals for that customer — a family's first visit with 2 children
  -- pays one referral fee sized to both sessions combined, not two fees.
  -- ----------------------------------------------------------------------
  for v_intro_row in
    select oi.customer_id, c.acquired_via_introducer_id as introducer_id, sum(oi.subtotal) as total_subtotal
    from order_items oi
    join customers c on c.id = oi.customer_id
    where oi.order_id = new.id
      and oi.item_type = 'detection_session'
      and c.acquired_via_introducer_id is not null
    group by oi.customer_id, c.acquired_via_introducer_id
  loop
    -- Skip if this customer already has an earlier paid detection_service order.
    if exists (
      select 1
      from orders o
      join order_items oi2 on oi2.order_id = o.id
      where oi2.customer_id = v_intro_row.customer_id
        and o.order_type = 'detection_service'
        and o.status = 'paid'
        and o.id <> new.id
    ) then
      continue;
    end if;

    for j in 1..2 loop
      if j = 1 then
        v_intro_payee := v_intro_row.introducer_id;
      else
        v_intro_payee := introducer_sponsor_at_level(v_intro_row.introducer_id, j - 1);
      end if;
      exit when v_intro_payee is null;

      select * into v_rule from get_active_rule('introducer', j);
      if v_rule.calculation_type is not null then
        perform insert_commission(
          'introducer', new.id, j, null, v_intro_payee,
          v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, v_intro_row.total_subtotal
        );
      end if;
    end loop;
  end loop;

  return new;
end;
$$;
