-- ============================================================================
-- Migration 025 — New "analyst report fee" commission (RM200 flat, paid
-- directly to the performing analyst on report delivery) + widen the
-- trigger_type check constraints to allow it.
--
-- Business context (2026-07-14, CTO instruction): on top of the existing
-- RM40 "report_override" paid to the performing analyst's assigned_leader_id
-- on report delivery, the performing analyst themselves should also get a
-- flat RM200 "interpretation fee" for completing that report — a genuinely
-- new payee, since previously commission_records never paid the selling/
-- reporting analyst directly (their compensation was implicitly the retail
-- margin, never a discrete commission_records row). PIC-channel items get
-- the same rate for now; the CTO flagged that PIC-channel pricing may differ
-- later, but gave no number yet, so no special-case branch is added here —
-- when that number arrives, add a PIC branch the same way report_override
-- already has one.
--
-- Fires from the same trigger/event as report_override (report_delivered_at
-- null -> not-null), so a delivered report always produces both payouts
-- atomically, same reasoning as the original RM40/report-cost pairing.
--
-- Self-contained + idempotent: constraint drop/re-add and
-- create-or-replace function are both safe to rerun.
-- ============================================================================

alter table commission_rules drop constraint if exists commission_rules_trigger_type_check;
alter table commission_rules add constraint commission_rules_trigger_type_check check (
  trigger_type in ('personal_sale', 'pic_channel', 'introducer', 'recruitment', 'voucher_resale', 'report_override', 'analyst_report_fee')
);

alter table commission_records drop constraint if exists commission_records_trigger_type_check;
alter table commission_records add constraint commission_records_trigger_type_check check (
  trigger_type in ('personal_sale', 'pic_channel', 'introducer', 'recruitment', 'voucher_resale', 'report_override', 'analyst_report_fee')
);

create or replace function calculate_report_override_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_id uuid;
  v_pic_analyst_id uuid;
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

  -- ---- 1. RM40 report override commission (to the leader/PIC) ----
  v_campaign_id := null;
  v_pic_analyst_id := null;
  if new.customer_id is not null then
    select acquired_via_campaign_id into v_campaign_id from customers where id = new.customer_id;
  end if;
  if v_campaign_id is not null then
    select pic_analyst_id into v_pic_analyst_id from channel_campaigns where id = v_campaign_id;
  end if;

  select * into v_rule from get_active_rule('report_override', 1);
  if v_rule.calculation_type is not null then
    if v_pic_analyst_id is not null then
      perform insert_item_commission(
        'report_override', new.id, 1, v_pic_analyst_id, null,
        v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, new.subtotal
      );
    elsif new.analyst_id is not null then
      select assigned_leader_id into v_leader_id from analysts where id = new.analyst_id;
      if v_leader_id is not null then
        perform insert_item_commission(
          'report_override', new.id, 1, v_leader_id, null,
          v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, new.subtotal
        );
      end if;
    end if;
  end if;

  -- ---- 2. RM200 analyst report fee (migration 025) — to the performing
  -- analyst directly, regardless of PIC-channel status (no PIC-specific
  -- rate has been given yet; add a branch here once one is). ----
  if new.analyst_id is not null then
    select * into v_rule from get_active_rule('analyst_report_fee', 1);
    if v_rule.calculation_type is not null then
      perform insert_item_commission(
        'analyst_report_fee', new.id, 1, new.analyst_id, null,
        v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, new.subtotal
      );
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
