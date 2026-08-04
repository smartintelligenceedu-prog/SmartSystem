-- ============================================================================
-- Migration 069 — Introducer referral commission nets off the analyst's own
-- report fee, instead of being paid on top of it
--
-- Previously: an introducer-referred customer's first report paid the
-- analyst RM200 (analyst_report_fee) AND the introducer RM50 separately —
-- RM250 total company payout for that one report.
--
-- New behavior (CTO decision, 2026-08-04): the introducer's RM50 comes OUT
-- OF the analyst's RM200 on whichever single report absorbs it — analyst
-- gets RM200 - RM50 = RM150, introducer gets RM50, RM200 total. Every other
-- report for that same customer (a sibling's report from the same first
-- order, or any later visit) still pays the analyst the fee in full, since
-- the introducer commission itself is only ever generated once per customer
-- and gets marked "consumed" the moment the first report claims it.
-- ============================================================================

alter table commission_records add column if not exists offset_by_order_item_id uuid references order_items(id);

-- Postgres treats a different parameter list as a different function
-- identity for CREATE OR REPLACE purposes, so the old 10-arg signature has
-- to be dropped before creating the 11-arg version below.
drop function if exists insert_item_commission(text, uuid, int, uuid, uuid, text, numeric, numeric, numeric, numeric);

create function insert_item_commission(
  p_trigger_type text,
  p_order_item_id uuid,
  p_level int,
  p_analyst_id uuid,
  p_introducer_id uuid,
  p_calculation_type text,
  p_rate numeric,
  p_flat_amount numeric,
  p_cap numeric,
  p_base numeric,
  p_deduction numeric default 0
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

  if p_deduction > 0 then
    v_amount := greatest(v_amount - p_deduction, 0);
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
  v_intro_rec record;
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
  -- Migration 069: when this customer was brought in by an introducer, the
  -- introducer's ONE-TIME referral commission(s) — level 1 AND level 2,
  -- whichever are actually configured — are netted off the analyst's fee on
  -- whichever single report is delivered FIRST for that customer, instead
  -- of being paid on top of it. Sums and consumes every not-yet-offset
  -- introducer row for this customer (so a future non-zero level 2 rate
  -- gets included automatically, not just level 1). Locked via `for update`
  -- + offset_by_order_item_id so two reports delivered around the same time
  -- (e.g. two siblings from the same first order) can't both claim the same
  -- introducer commission(s). Every other report for that customer pays the
  -- analyst the fee in full, since the introducer rows are already
  -- consumed. A different customer's own introducer commission is entirely
  -- unaffected — this only ever looks at rows for new.customer_id.
  if new.analyst_id is not null then
    if v_campaign_id is not null and v_pic_analyst_report_fee_amount is not null then
      perform insert_item_commission(
        'analyst_report_fee', new.id, 1, new.analyst_id, null,
        'flat', null, v_pic_analyst_report_fee_amount, null, new.subtotal
      );
    else
      select * into v_rule from get_active_rule('analyst_report_fee', 1);
      if v_rule.calculation_type is not null then
        v_intro_deduction := 0;
        if new.customer_id is not null then
          for v_intro_rec in
            select id, commission_amount
            from commission_records
            where trigger_type = 'introducer'
              and customer_id = new.customer_id
              and offset_by_order_item_id is null
            order by level_number asc
            for update
          loop
            v_intro_deduction := v_intro_deduction + v_intro_rec.commission_amount;
            update commission_records set offset_by_order_item_id = new.id where id = v_intro_rec.id;
          end loop;
        end if;

        perform insert_item_commission(
          'analyst_report_fee', new.id, 1, new.analyst_id, null,
          v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, new.subtotal,
          v_intro_deduction
        );
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
