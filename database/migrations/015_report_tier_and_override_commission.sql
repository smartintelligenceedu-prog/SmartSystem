-- ============================================================================
-- Migration 015 — Report tier classification + delivery-triggered override
-- commission + report cost (COGS) posting.
--
-- Business rules implemented (confirmed with the user, 2026-07-13):
--   1. Report delivery status/classification moves from orders (one shared
--      flag for the whole order) to order_items (one per person/report) —
--      required because a multi-person order can have different people's
--      reports finish and get delivered at different times, and each report
--      independently needs a standard/upgrade classification.
--   2. Normal (non-PIC-channel) items: delivering the report pays a flat
--      RM40 "report override" commission to the performing analyst's
--      assigned_leader_id, IN ADDITION TO (stacks with) the personal_sale
--      commission already paid at sale time. This is a new use of
--      assigned_leader_id as a commission recipient — previously
--      "operational assignment, no commission effect" (see schema.sql).
--   3. PIC-channel items: the RM40 report-override goes to the campaign's
--      PIC instead, and REPLACES the pic_channel commission that used to
--      fire at sale time (not stacked). See commission_engine.sql for the
--      corresponding trigger change that stops the sale-time PIC payout.
--   4. Report cost (COGS) is auto-posted to the ledger the moment a report
--      is marked delivered (RM25 standard / RM125 upgrade) — the user
--      explicitly asked for this to be automatic and to show up in the P&L
--      immediately, unlike orders/commission_records which stay on the
--      existing manual/periodic batch-posting flow (finance/actions.ts).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. order_items: per-report classification + delivery timestamp.
-- ----------------------------------------------------------------------------

alter table order_items add column if not exists report_tier text check (report_tier in ('standard', 'upgrade'));
alter table order_items add column if not exists report_delivered_at timestamptz;

-- Backfill from the old order-level flag for orders already marked
-- delivered before this migration. Tier is unknowable retroactively, so it
-- is left null on backfilled rows — no cost/commission is created for these
-- (only the forward-looking null -> not-null transition on order_items
-- fires the new trigger below).
update order_items oi
set report_delivered_at = o.report_delivered_at
from orders o
where oi.order_id = o.id
  and o.report_delivered_at is not null
  and oi.item_type in ('detection_session', 'voucher_redemption')
  and oi.report_delivered_at is null;

-- ----------------------------------------------------------------------------
-- 2. New commission trigger_type: 'report_override'. Drops and re-adds the
--    check constraints by looking them up dynamically rather than assuming
--    Postgres's default-generated name, so this doesn't depend on guessing
--    right.
-- ----------------------------------------------------------------------------

do $$
declare
  con record;
begin
  for con in
    select c.conname, c.conrelid::regclass::text as tbl
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    where rel.relname in ('commission_rules', 'commission_records')
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%trigger_type%'
  loop
    execute format('alter table %s drop constraint %I', con.tbl, con.conname);
  end loop;
end;
$$;

alter table commission_rules add constraint commission_rules_trigger_type_check
  check (trigger_type in ('personal_sale', 'pic_channel', 'introducer', 'recruitment', 'voucher_resale', 'report_override'));

alter table commission_records add constraint commission_records_trigger_type_check
  check (trigger_type in ('personal_sale', 'pic_channel', 'introducer', 'recruitment', 'voucher_resale', 'report_override'));

-- Seed the flat RM40 rule (level 1 only — assigned_leader_id/PIC is a single
-- column, not a recursive sponsor chain, so there is no level 2/3 to cascade to).
insert into commission_rules (plan_id, trigger_type, level_number, calculation_type, flat_amount, effective_from)
select id, 'report_override', 1, 'flat', 40.00, current_date
from compensation_plans
where name = 'Default Compensation Plan'
  and not exists (
    select 1 from commission_rules where trigger_type = 'report_override' and level_number = 1
  );

-- ----------------------------------------------------------------------------
-- 3. Chart of accounts: report cost is a distinct cost category from
--    commission expense (5000-5400, already in use) — not paid to an
--    analyst/introducer, so it gets its own expense + accrued-liability pair
--    rather than reusing the commission "payable" account (2000), keeping
--    the two traceable separately.
-- ----------------------------------------------------------------------------

insert into chart_of_accounts (code, name, account_type) values
  ('5600', '报告制作成本', 'expense'),
  ('2100', '应计报告成本', 'liability')
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- 4. Trigger function changes (commission_engine.sql v1.3). Safe to re-run —
--    create-or-replace + drop-if-exists/create is idempotent.
--
--    a) calculate_commissions_for_order(): PIC-channel items no longer get a
--       sale-time commission at all (that payout is deferred to delivery
--       time — see (b) below). Registration branch and non-PIC items are
--       byte-for-byte unchanged.
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

    -- PIC-channel items: no sale-time commission at all (moved to delivery
    -- time — see calculate_report_override_commission() below).
    if v_campaign_id is not null then
      null;
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
--    b) New: calculate_report_override_commission() — fires on the
--       order_items.report_delivered_at null -> not-null transition. Pays
--       the RM40 report-override commission (assigned_leader_id normally,
--       PIC instead for channel items) and auto-posts the report's hard
--       cost to the ledger, both in the same transaction as the UPDATE that
--       marks delivery.
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
