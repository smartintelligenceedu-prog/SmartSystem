-- ============================================================================
-- TQC Business Management System — Commission Engine (v1.3)
-- Apply after schema.sql + rls_policies.sql.
--
-- Design note: the actual calculation runs as a Postgres trigger (not an Edge
-- Function) so it commits atomically with the order that caused it — an
-- order can never end up "paid" with no commission calculated, or vice
-- versa, because they're the same transaction. Edge Functions are reserved
-- for work that genuinely needs to live outside the database: the periodic
-- payout batch (settle-commissions Edge Function, see supabase/functions/).
--
-- v1.1: commission_rules can now be percentage-based OR a flat amount (see
-- schema.sql's calculation_type column) — a business decision that rates
-- don't always have to be "% of the transaction". Individual
-- commission_records can also be manually adjusted after the fact by
-- admin/finance, with the original auto-calculated amount preserved for audit.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: walk N levels up an analyst's sponsor chain.
-- level 1 = direct sponsor, level 2 = sponsor's sponsor, etc.
-- Returns null once the chain runs out (top-level analyst with no upline).
-- ----------------------------------------------------------------------------

create or replace function sponsor_at_level(start_analyst_id uuid, target_level int)
returns uuid
language sql stable
as $$
  with recursive chain as (
    select sponsor_id as id, 1 as lvl from analysts where id = start_analyst_id
    union all
    select a.sponsor_id, chain.lvl + 1
    from analysts a
    join chain on a.id = chain.id
    where chain.id is not null
  )
  select id from chain where lvl = target_level
$$;

-- Same shape as sponsor_at_level() above, but for introducers.sponsor_id
-- (migration 014) — introducers can refer other introducers, paying a
-- 2-level introducer commission instead of the 3-level analyst chain.
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

-- ----------------------------------------------------------------------------
-- Helper: look up the currently-effective rule for a trigger type + level.
-- Pulls from the active compensation plan; a missing rule means "don't pay
-- this level" rather than an error, so partial rule sets degrade safely.
-- Returns the whole rule (not just a rate) since a rule can now be either
-- percentage-based or a flat amount.
-- ----------------------------------------------------------------------------

create or replace function get_active_rule(p_trigger_type text, p_level int, p_as_of date default current_date)
returns table(calculation_type text, rate_percent numeric, flat_amount numeric, cap_amount numeric)
language sql stable
as $$
  select cr.calculation_type, cr.rate_percent, cr.flat_amount, cr.cap_amount
  from commission_rules cr
  join compensation_plans cp on cp.id = cr.plan_id and cp.is_active
  where cr.trigger_type = p_trigger_type
    and cr.level_number = p_level
    and cr.effective_from <= p_as_of
    and (cr.effective_to is null or cr.effective_to >= p_as_of)
  order by cr.effective_from desc
  limit 1
$$;

-- ----------------------------------------------------------------------------
-- Small insert helper so the branches below stay readable. Computes the
-- final amount from whichever calculation_type the rule uses, then applies
-- the cap (if the rule has one — the "no cap" business decision from the
-- Registration Module still holds by default, this is an opt-in per rule).
-- ----------------------------------------------------------------------------

create or replace function insert_commission(
  p_trigger_type text,
  p_order_id uuid,
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
    p_trigger_type, 'order', p_order_id,
    p_level, p_analyst_id, p_introducer_id, p_calculation_type,
    case when p_calculation_type = 'flat' then null else p_rate end,
    p_base, v_amount
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Per-item commission insert helper (v1.2, migration 012). Same as
-- insert_commission() above except source_transaction_type is 'order_item'
-- (source_transaction_id = order_items.id) instead of 'order' — this is what
-- makes it possible to trace which specific person's commission a record
-- belongs to when a multi-person order (e.g. a family visiting together)
-- credits different items to different agents. Additive: insert_commission()
-- itself is untouched and still used by the registration branch below.
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
-- Main trigger function — fires when an order transitions into 'paid'.
-- ----------------------------------------------------------------------------

-- security definer: this function reads commission_rules, channel_campaigns
-- and writes commission_records — all of which are RLS-restricted to back
-- office. Without security definer, this trigger would silently compute
-- zero commissions whenever a regular analyst session (not back office)
-- causes the order to become 'paid'.
--
-- v1.2 (migration 012): the detection_service branch moved from computing
-- one commission pass for the whole order (using orders.customer_id /
-- orders.analyst_id / orders.total_amount) to looping every order_item and
-- computing commission per item (using that item's own customer_id /
-- analyst_id / subtotal) — this is what lets one order cover several people
-- (e.g. a family visiting together), each credited to their own agent. The
-- registration branch is completely unchanged.
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
  v_introducer_id uuid;
  v_intro_payee uuid;
  v_item order_items%rowtype;
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
    v_introducer_id := null;
    if v_item.customer_id is not null then
      select acquired_via_campaign_id, acquired_via_introducer_id
        into v_campaign_id, v_introducer_id
      from customers where id = v_item.customer_id;
    end if;

    -- Personal sale vs. PIC channel sale are mutually exclusive per item.
    -- v1.3 (migration 015): PIC-channel items no longer get a commission at
    -- sale time at all — that payout moved to report-delivery time instead
    -- (see calculate_report_override_commission() below), where the PIC
    -- gets a flat RM40 "report override" commission, replacing (not
    -- stacking with) what pic_channel used to pay here. commission_rules
    -- keeps the 'pic_channel' rows for historical/audit purposes but the
    -- trigger no longer calls get_active_rule('pic_channel', ...).
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

    -- Introducer referral fee: level 1 = the direct introducer, level 2 =
    -- that introducer's own upline introducer (if any, via
    -- introducer_sponsor_at_level() — migration 014). Stacks on top of
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

drop trigger if exists trg_calculate_commissions on orders;
create trigger trg_calculate_commissions
  after insert or update of status on orders
  for each row
  execute function calculate_commissions_for_order();

-- ----------------------------------------------------------------------------
-- Report-delivery-triggered commission + cost (v1.3, migration 015).
--
-- Fires once, on the report_delivered_at null -> not-null transition on an
-- order_item (report delivery is per-person/per-report, not per-order — see
-- migration 015's comment). Two independent things happen in the same
-- transaction as the UPDATE that marks delivery, so there is no window
-- where "delivered" is true but the payout/cost is missing:
--
--   1. A flat RM40 "report override" commission: to the performing
--      analyst's assigned_leader_id normally, or to the campaign's PIC
--      instead if this item came through a channel campaign (replacing,
--      not stacking with, the pic_channel commission that no longer fires
--      at sale time for these items — see calculate_commissions_for_order()
--      above).
--   2. The report's hard cost (RM25 standard / RM125 upgrade) is posted
--      immediately to the ledger (debit 5600 报告制作成本 expense, credit
--      2100 应计报告成本 liability) — auto-posted rather than going through
--      the manual/periodic postToLedger() batch flow that orders and
--      commission_records use, per explicit user instruction that report
--      cost should hit the P&L the moment the report is delivered.
--
-- security definer: chart_of_accounts/journal_entries/journal_lines and
-- commission_rules are all back-office-only RLS — same reasoning as
-- calculate_commissions_for_order() above.
-- ----------------------------------------------------------------------------

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

  -- ---- 1. RM40 report override commission ----
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

  -- ---- 2. Report cost (COGS), auto-posted immediately ----
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

drop trigger if exists trg_report_override_commission on order_items;
create trigger trg_report_override_commission
  after update of report_delivered_at on order_items
  for each row
  execute function calculate_report_override_commission();

-- ----------------------------------------------------------------------------
-- Approval step: back office reviews 'pending' records (e.g. past the refund
-- window) and flips them to 'approved'. Left as a plain UPDATE for the admin
-- UI to call — no dedicated function needed for something this simple.
--
--   update commission_records set status = 'approved'
--   where status = 'pending' and calculated_at < now() - interval '14 days';
--
-- Manual amount override (admin/finance only — enforced in the app layer's
-- Server Action, not here) preserves the original auto-calculated amount:
--
--   update commission_records
--   set original_amount = coalesce(original_amount, commission_amount),
--       commission_amount = <new amount>,
--       adjusted_by = <users.id>, adjusted_at = now(), adjustment_reason = <text>
--   where id = <commission_records.id>;
-- ----------------------------------------------------------------------------
