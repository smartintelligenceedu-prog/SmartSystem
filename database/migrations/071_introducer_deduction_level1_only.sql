-- ============================================================================
-- Migration 071 — Correction: only the introducer's LEVEL 1 commission nets
-- off the analyst's report fee; level 2 stays a separate company expense
--
-- Migration 069 summed and deducted BOTH introducer levels (1 and 2) from
-- the analyst's RM200 report fee. That was wrong: level 1 (the direct
-- introducer) really does come out of the analyst's own fee, but level 2
-- (that introducer's own upline) is funded by the company separately — it
-- was never meant to reduce the analyst's take. Level 2 keeps posting to
-- 5300 Commission Expense - Introducer exactly as it always has via
-- calculate_commissions_for_order(), completely unrelated to this function.
-- ============================================================================

create or replace function calculate_report_override_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_id uuid;
  v_pic_analyst_id uuid;
  v_pic_report_override_amount numeric;
  v_pic_analyst_report_fee_amount numeric;
  v_leader_id uuid;
  v_rule record;
  v_cost numeric;
  v_standard_cost numeric;
  v_upgrade_cost numeric;
  v_expense_account uuid;
  v_liability_account uuid;
  v_entry_id uuid;
  v_intro_commission_id uuid;
  v_intro_deduction numeric;
begin
  if new.report_delivered_at is null or old.report_delivered_at is not null then
    return new;
  end if;
  if new.item_type not in ('detection_session', 'voucher_redemption') then
    return new;
  end if;

  -- ---- 1. Report override commission (to the leader, or the PIC if this
  -- item came through a channel campaign) ----
  v_campaign_id := null;
  v_pic_analyst_id := null;
  v_pic_report_override_amount := null;
  v_pic_analyst_report_fee_amount := null;
  if new.customer_id is not null then
    select acquired_via_campaign_id into v_campaign_id from customers where id = new.customer_id;
  end if;
  if v_campaign_id is not null then
    select pic_analyst_id, pic_report_override_amount, pic_analyst_report_fee_amount
      into v_pic_analyst_id, v_pic_report_override_amount, v_pic_analyst_report_fee_amount
    from channel_campaigns where id = v_campaign_id;
  end if;

  if v_pic_analyst_id is not null then
    if v_pic_report_override_amount is not null then
      perform insert_item_commission(
        'report_override', new.id, 1, v_pic_analyst_id, null,
        'flat', null, v_pic_report_override_amount, null, new.subtotal
      );
    else
      select * into v_rule from get_active_rule('report_override', 1);
      if v_rule.calculation_type is not null then
        perform insert_item_commission(
          'report_override', new.id, 1, v_pic_analyst_id, null,
          v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, new.subtotal
        );
      end if;
    end if;
  elsif new.analyst_id is not null then
    select assigned_leader_id into v_leader_id from analysts where id = new.analyst_id;
    if v_leader_id is not null then
      select * into v_rule from get_active_rule('report_override', 1);
      if v_rule.calculation_type is not null then
        perform insert_item_commission(
          'report_override', new.id, 1, v_leader_id, null,
          v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, new.subtotal
        );
      end if;
    end if;
  end if;

  -- ---- 2. Analyst report fee (migration 025) — to the performing analyst
  -- directly. Migration 026: uses the campaign's fixed
  -- pic_analyst_report_fee_amount when this item came through a PIC channel
  -- campaign that has one set; otherwise falls back to the global rule.
  --
  -- Migration 071 (correcting migration 069): only the introducer's LEVEL 1
  -- commission (the direct introducer, paid once on this customer's first
  -- paid order) is netted off the analyst's fee on whichever single report
  -- is delivered FIRST for that customer. Level 2 (that introducer's own
  -- upline) is a separate company-funded expense and never touches the
  -- analyst's fee. Locked via `for update` + offset_by_order_item_id so two
  -- reports delivered around the same time (e.g. two siblings from the same
  -- first order) can't both claim the same level-1 commission.
  if new.analyst_id is not null then
    if v_campaign_id is not null and v_pic_analyst_report_fee_amount is not null then
      perform insert_item_commission(
        'analyst_report_fee', new.id, 1, new.analyst_id, null,
        'flat', null, v_pic_analyst_report_fee_amount, null, new.subtotal
      );
    else
      select * into v_rule from get_active_rule('analyst_report_fee', 1);
      if v_rule.calculation_type is not null then
        v_intro_commission_id := null;
        v_intro_deduction := null;
        if new.customer_id is not null then
          select id, commission_amount into v_intro_commission_id, v_intro_deduction
          from commission_records
          where trigger_type = 'introducer'
            and level_number = 1
            and customer_id = new.customer_id
            and offset_by_order_item_id is null
          order by calculated_at asc
          limit 1
          for update;
        end if;

        perform insert_item_commission(
          'analyst_report_fee', new.id, 1, new.analyst_id, null,
          v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, new.subtotal,
          coalesce(v_intro_deduction, 0)
        );

        if v_intro_commission_id is not null then
          update commission_records set offset_by_order_item_id = new.id where id = v_intro_commission_id;
        end if;
      end if;
    end if;
  end if;

  -- ---- 3. Report cost (COGS), auto-posted immediately. ----
  if new.report_tier is not null then
    select (value->>'standardCost')::numeric, (value->>'upgradeCost')::numeric
      into v_standard_cost, v_upgrade_cost
    from settings where key = 'report_cost';

    v_cost := case new.report_tier
      when 'standard' then coalesce(v_standard_cost, 25.00)
      when 'upgrade' then coalesce(v_upgrade_cost, 125.00)
      else 0
    end;
    select id into v_expense_account from chart_of_accounts where code = '5600';
    select id into v_liability_account from chart_of_accounts where code = '2100';
    if v_cost > 0 and v_expense_account is not null and v_liability_account is not null then
      insert into journal_entries (entry_date, source_type, source_id, description, posted_by)
      values (current_date, 'report_delivery', new.id, '报告制作成本 - ' || new.report_tier, 'system')
      returning id into v_entry_id;

      insert into journal_lines (journal_entry_id, account_id, debit, credit) values
        (v_entry_id, v_expense_account, v_cost, 0),
        (v_entry_id, v_liability_account, 0, v_cost);
    end if;
  end if;

  return new;
end;
$$;
