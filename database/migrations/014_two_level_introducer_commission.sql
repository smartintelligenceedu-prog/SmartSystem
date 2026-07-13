-- ============================================================================
-- Migration 014 — Two-level Introducer commission
--
-- Introducers can now refer other introducers (introducers.sponsor_id, self-
-- referencing, mirrors analysts.sponsor_id). When a customer referred by
-- introducer B buys a detection service, B gets the level-1 introducer
-- commission and B's own upline introducer (if any) gets level 2 — same
-- "walk N levels up a sponsor chain" shape as sponsor_at_level() for
-- analysts, just for introducers and capped at 2 levels instead of 3.
-- ============================================================================

alter table introducers add column if not exists sponsor_id uuid references introducers(id);
create index if not exists idx_introducers_sponsor on introducers(sponsor_id);

-- Seed level 2 with the same 10% placeholder every other rule started with —
-- edit via /admin/commission/rules before real money moves, same as the rest.
insert into commission_rules (plan_id, trigger_type, level_number, calculation_type, rate_percent, effective_from)
select id, 'introducer', 2, 'percentage', 10.00, current_date
from compensation_plans
where is_active = true
on conflict do nothing;

create or replace function introducer_sponsor_at_level(start_introducer_id uuid, target_level int)
returns uuid
language sql stable
as $$
  with recursive chain as (
    select sponsor_id as id, 1 as lvl from introducers where id = start_introducer_id
    union all
    select i.sponsor_id, chain.lvl + 1
    from introducers i
    join chain on i.id = chain.id
    where chain.id is not null
  )
  select id from chain where lvl = target_level
$$;

-- Replace just the introducer-payout portion of the detection_service branch
-- (everything else in calculate_commissions_for_order() — registration
-- branch, voucher_redemption, personal_sale/pic_channel — is byte-for-byte
-- identical to migration 012's version).
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
  v_intro_payee uuid;
  v_item order_items%rowtype;
  i int;
  j int;
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
      continue;
    end if;

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

    -- Introducer referral fee: level 1 = the direct introducer, level 2 =
    -- that introducer's own upline introducer (if any). Stacks on top of
    -- whichever personal_sale/pic_channel rule fired above.
    if v_introducer_id is not null then
      for j in 1..2 loop
        if j = 1 then
          v_intro_payee := v_introducer_id;
        else
          v_intro_payee := introducer_sponsor_at_level(v_introducer_id, j - 1);
        end if;
        exit when v_intro_payee is null;

        select * into v_rule from get_active_rule('introducer', j);
        if v_rule.calculation_type is not null then
          perform insert_item_commission(
            'introducer', v_item.id, j, null, v_intro_payee,
            v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, v_item.subtotal
          );
        end if;
      end loop;
    end if;
  end loop;

  return new;
end;
$$;
