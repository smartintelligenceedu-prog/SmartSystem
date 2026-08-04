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

-- p_customer_id (migration 035, default null): only the introducer branch
-- below passes it — every other trigger_type (recruitment, etc.) leaves it
-- null. Backs the phone-number duplicate guard and the commission-page
-- customer/phone display, both of which need to know which customer an
-- introducer commission was for without reconstructing it from
-- source_transaction_id each time.
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
  p_base numeric,
  p_customer_id uuid default null
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
    level_number, analyst_id, introducer_id, calculation_type, rate_applied, base_amount, commission_amount,
    customer_id
  ) values (
    p_trigger_type, 'order', p_order_id,
    p_level, p_analyst_id, p_introducer_id, p_calculation_type,
    case when p_calculation_type = 'flat' then null else p_rate end,
    p_base, v_amount,
    p_customer_id
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

-- Migration 069 — old 10-arg signature dropped so this is a true replace,
-- not a second overload sitting alongside the original (Postgres treats a
-- different parameter list as a different function identity for CREATE OR
-- REPLACE purposes, same reason team_summary() needed a drop first).
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
  -- Migration 069 — nets off an already-paid one-time introducer referral
  -- commission against whichever single report absorbs it (see the call
  -- site in calculate_report_override_commission()), instead of paying
  -- both amounts in full. Every other caller (report_override,
  -- personal_sale, voucher_resale, the PIC-campaign analyst fee) leaves
  -- this at its default and behaves exactly as before.
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
  v_intro_payee uuid;
  v_item order_items%rowtype;
  v_intro_row record;
  v_customer_phone text;
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
    -- sale time at all — that payout moved to report-delivery time instead
    -- (see calculate_report_override_commission() below), where the PIC
    -- gets a flat RM40 "report override" commission, replacing (not
    -- stacking with) what pic_channel used to pay here. commission_rules
    -- keeps the 'pic_channel' rows for historical/audit purposes but the
    -- trigger no longer calls get_active_rule('pic_channel', ...).
    -- 2026-07-14: the CTO decided the sponsor override at sale time is
    -- redundant with the new RM200 analyst_report_fee (paid to whoever
    -- actually completes the report — see calculate_report_override_commission()
    -- below) and closed out the 'personal_sale' commission_rules row with no
    -- replacement (effective_to set, no new row inserted). get_active_rule()
    -- returning no row makes v_rule.calculation_type null, so this branch is
    -- a no-op today — no code change was needed to disable it. The branch is
    -- kept (not deleted) so a future compensation plan can re-enable it by
    -- simply inserting a new active 'personal_sale' rule again.
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

  -- --------------------------------------------------------------------
  -- Introducer referral fee (v1.4, migration 024) — ONE-TIME per customer,
  -- paid only on that customer's first-ever paid detection_service order,
  -- never again on later orders no matter how many more children/sessions
  -- they bring. Base amount = sum of THIS (first) order's detection_session
  -- item subtotals for that customer — a family's first visit with 2
  -- children pays one referral fee sized to both sessions combined, not two
  -- separate fees. (Previously this fired per order_item inside the loop
  -- above, so a 2-child order paid the introducer twice — the CTO flagged
  -- this as wrong after reviewing live demo data.) Level 1 = the direct
  -- introducer, level 2 = that introducer's own upline introducer (if any,
  -- via introducer_sponsor_at_level() — migration 014).
  --
  -- Migration 035: also blocks by phone number, not just customer_id — a
  -- same-person re-registered under a second customer record (different
  -- customer_id) would otherwise slip past the check below and pay the
  -- introducer twice for what is really one person's repeat visit.
  -- --------------------------------------------------------------------
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

    -- Skip if this customer's phone number already has an approved/paid
    -- introducer commission on record under a DIFFERENT customer_id.
    select i.phone into v_customer_phone
    from customers c2
    join individuals i on i.party_id = c2.party_id
    where c2.id = v_intro_row.customer_id;

    if v_customer_phone is not null and v_customer_phone <> '' and exists (
      select 1
      from commission_records cr
      join customers c3 on c3.id = cr.customer_id
      join individuals i2 on i2.party_id = c3.party_id
      where cr.trigger_type = 'introducer'
        and cr.status in ('approved', 'paid')
        and cr.customer_id <> v_intro_row.customer_id
        and i2.phone = v_customer_phone
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
          v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, v_intro_row.total_subtotal,
          v_intro_row.customer_id
        );
      end if;
    end loop;
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
--   2. The report's hard cost (default RM25 standard / RM125 upgrade,
--      configurable at /admin/settings since migration 060 — see
--      settings.report_cost) is posted immediately to the ledger (debit
--      5600 报告制作成本 expense, credit 2100 应计报告成本 liability) —
--      auto-posted rather than going through the manual/periodic
--      postToLedger() batch flow that orders and commission_records use,
--      per explicit user instruction that report cost should hit the P&L
--      the moment the report is delivered.
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
  -- PIC-campaign customers never reach this branch at all (handled above),
  -- so there's no overlap between the two acquisition channels.
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

  -- ---- 3. Report cost (COGS), auto-posted immediately. Migration 060:
  -- standard/upgrade cost now read from settings.report_cost (editable at
  -- /admin/settings) instead of being hardcoded — falls back to the
  -- original RM25/RM125 if the settings row is ever missing. ----
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

drop trigger if exists trg_report_override_commission on order_items;
create trigger trg_report_override_commission
  after update of report_delivered_at on order_items
  for each row
  execute function calculate_report_override_commission();

-- ----------------------------------------------------------------------------
-- Institutional package commission (migration 045) — optional fixed
-- commission for a negotiated bulk package deal (institutional_packages,
-- migration 044), mirroring channel_campaigns' pic_report_override_amount /
-- pic_analyst_report_fee_amount. Institutional order_items have no
-- customer/child_id (the "student names" are just description text, not
-- real customer records), so they never flow through
-- calculate_commissions_for_order()'s campaign lookup or
-- calculate_report_override_commission()'s report_delivered_at trigger —
-- both require order_items.customer_id to resolve anything. Without this,
-- a package-linked institutional order's assigned analyst never actually
-- earned any commission.
--
-- Fires per order_item on INSERT (not on the orders row) — the app layer
-- inserts the order first and its order_items in a second, separate call,
-- so a trigger on orders would fire before any order_items exist yet. This
-- also makes idempotency trivial: check per-item, not per-order.
-- ----------------------------------------------------------------------------

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

  if exists (
    select 1 from commission_records
    where source_transaction_type = 'order_item'
      and source_transaction_id = new.id
      and trigger_type in ('report_override', 'analyst_report_fee')
  ) then
    return new; -- already generated (idempotency guard)
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

-- ----------------------------------------------------------------------------
-- Migration 048 — optional flat commission paid to a package's responsible
-- analyst the moment its deposit payment is actually recorded (not at
-- package creation), e.g. "10% deposit, 50% of that to the responsible
-- person". Fires on payments insert; coexists with trg_payment_recorded on
-- the same table/event.
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- Migration 052 — sponsor tree maintenance. admin_reassign_analyst_sponsor()
-- lets back office move any analyst under a different sponsor at any time
-- (cycle-guarded). admin_set_analyst_suspend_status() replaces a plain
-- status UPDATE: suspending an analyst auto re-parents their direct
-- downlines to that analyst's own sponsor (skip-over), so sponsor_at_level()
-- stops resolving new recruitment commission to a suspended account.
-- Resuming does NOT auto-revert. Neither function touches existing
-- commission_records — only sponsor_id going forward.
-- ----------------------------------------------------------------------------

create or replace function admin_reassign_analyst_sponsor(p_analyst_id uuid, p_new_sponsor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_walk uuid;
begin
  if p_new_sponsor_id is not null then
    if p_new_sponsor_id = p_analyst_id then
      raise exception 'an analyst cannot be their own sponsor';
    end if;
    if not exists (select 1 from analysts where id = p_new_sponsor_id) then
      raise exception 'new sponsor % not found', p_new_sponsor_id;
    end if;
    v_walk := p_new_sponsor_id;
    while v_walk is not null loop
      if v_walk = p_analyst_id then
        raise exception 'cannot reassign: % is a descendant of %, this would create a cycle', p_new_sponsor_id, p_analyst_id;
      end if;
      select sponsor_id into v_walk from analysts where id = v_walk;
    end loop;
  end if;

  update analysts set sponsor_id = p_new_sponsor_id, updated_at = now() where id = p_analyst_id;
end;
$$;

create or replace function admin_set_analyst_suspend_status(p_analyst_id uuid, p_suspend boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status text;
  v_own_sponsor uuid;
begin
  select status, sponsor_id into v_current_status, v_own_sponsor from analysts where id = p_analyst_id for update;
  if not found then
    raise exception 'analyst % not found', p_analyst_id;
  end if;
  if p_suspend and v_current_status <> 'approved' then
    raise exception 'only an approved analyst can be suspended (current status: %)', v_current_status;
  end if;
  if not p_suspend and v_current_status <> 'suspended' then
    raise exception 'analyst is not suspended (current status: %)', v_current_status;
  end if;

  update analysts
  set status = case when p_suspend then 'suspended' else 'approved' end, updated_at = now()
  where id = p_analyst_id;

  if p_suspend then
    update analysts set sponsor_id = v_own_sponsor, updated_at = now() where sponsor_id = p_analyst_id;
  end if;
end;
$$;
