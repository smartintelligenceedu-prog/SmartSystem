-- ============================================================================
-- Migration 026 — Per-project fixed commission for PIC channel campaigns.
--
-- Business context (2026-07-14, CTO instruction): for a PIC (Person In
-- Charge) channel campaign (school/institution/roadshow outreach), the CTO
-- wants the WHOLE commission package for that project set once when the
-- project is created, and have it stay fixed forever afterward — immune to
-- later changes to the global commission_rules defaults. This covers both
-- payouts that currently fire on report delivery:
--   1. report_override (to the PIC, replacing the leader's usual RM40 cut)
--   2. analyst_report_fee (to whoever actually completed the report, RM200 default)
--
-- Design: two new nullable flat-amount columns directly on channel_campaigns.
-- null means "no project-specific override — fall back to whatever the
-- global commission_rules say at the time", so existing/older campaigns
-- (and any that don't need customization) keep working exactly as before.
-- When set, the campaign's own number is used verbatim, bypassing
-- get_active_rule() entirely for that trigger on that project.
--
-- Self-contained + idempotent: add-column-if-not-exists is safe to rerun,
-- and create-or-replace function is always safe to rerun.
-- ============================================================================

alter table channel_campaigns add column if not exists pic_report_override_amount numeric(12,2);
alter table channel_campaigns add column if not exists pic_analyst_report_fee_amount numeric(12,2);

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
  v_expense_account uuid;
  v_liability_account uuid;
  v_entry_id uuid;
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
    -- Migration 026: a project-fixed amount set on the campaign itself
    -- always wins over the global rule, and never changes even if the
    -- global default rate changes later.
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
  -- campaign that has one set; otherwise falls back to the global rule. ----
  if new.analyst_id is not null then
    if v_campaign_id is not null and v_pic_analyst_report_fee_amount is not null then
      perform insert_item_commission(
        'analyst_report_fee', new.id, 1, new.analyst_id, null,
        'flat', null, v_pic_analyst_report_fee_amount, null, new.subtotal
      );
    else
      select * into v_rule from get_active_rule('analyst_report_fee', 1);
      if v_rule.calculation_type is not null then
        perform insert_item_commission(
          'analyst_report_fee', new.id, 1, new.analyst_id, null,
          v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, new.subtotal
        );
      end if;
    end if;
  end if;

  -- ---- 3. Report cost (COGS), auto-posted immediately ----
  if new.report_tier is not null then
    v_cost := case new.report_tier when 'standard' then 25.00 when 'upgrade' then 125.00 else 0 end;
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
