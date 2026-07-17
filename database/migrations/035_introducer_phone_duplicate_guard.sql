-- ============================================================================
-- Migration 035 — Phone-number duplicate guard for introducer commission
-- (2026-07-17, CTO request): the existing "once per customer" rule
-- (migration 024) only checks customers.id — it can't catch the same real
-- person re-entered under a SECOND customer record (retyped name, entered
-- by a different analyst, etc.), which would pay the introducer a second
-- referral fee for what is actually the same person's repeat visit. Rather
-- than requiring IC verification (sensitive, and IC numbers are sometimes
-- entered inconsistently), this adds a phone-number cross-check: before
-- paying an introducer, check whether ANY other customer sharing this
-- customer's phone number already has an approved/paid introducer
-- commission on record. If so, treat this as the same person and skip.
--
-- Self-contained + idempotent: every statement guarded, safe to rerun.
-- ============================================================================

alter table commission_records add column if not exists customer_id uuid references customers(id);
create index if not exists idx_commission_records_customer on commission_records(customer_id) where customer_id is not null;

-- ----------------------------------------------------------------------------
-- insert_commission(): added a trailing p_customer_id (default null, so
-- every other existing call site — recruitment, personal_sale, voucher via
-- insert_item_commission, etc. — is unaffected). Only the introducer branch
-- below passes it. Explicit drop-then-create (not just "or replace") because
-- adding a parameter changes the function's argument-type signature —
-- "or replace" alone would leave the old 10-arg version behind as a second,
-- now-unused overload instead of actually replacing it (same reasoning as
-- migration 006's insert_commission() signature change).
-- ----------------------------------------------------------------------------

drop function if exists insert_commission(text, uuid, int, uuid, uuid, text, numeric, numeric, numeric, numeric);

create function insert_commission(
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
-- calculate_commissions_for_order(): unchanged except the introducer loop
-- gains the phone-number duplicate check (new declared variable
-- v_customer_phone) between the existing per-customer_id order check and
-- the payout loop, and the insert_commission() call now passes
-- v_intro_row.customer_id.
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
  -- separate fees. Level 1 = the direct introducer, level 2 = that
  -- introducer's own upline introducer (if any, via
  -- introducer_sponsor_at_level() — migration 014).
  --
  -- Migration 035: also blocks by phone number, not just customer_id — a
  -- same-person re-registered under a second customer record (different
  -- customer_id) would otherwise slip past the check above and pay the
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

-- Trigger definition itself is unchanged (same function name/signature),
-- but recreated defensively so this migration is fully self-contained.
drop trigger if exists trg_calculate_commissions on orders;
create trigger trg_calculate_commissions
  after insert or update of status on orders
  for each row
  execute function calculate_commissions_for_order();

-- Backfill customer_id on existing introducer commission_records rows, so
-- the new phone-duplicate check and the commission-page UI display both
-- work for commissions calculated before this migration, not just new ones.
-- Only ever one order_item.customer_id per introducer-trigger row (see the
-- "group by oi.customer_id" above — one row per customer per order), so
-- this is a safe 1:1 backfill, not a guess across multiple candidates.
update commission_records cr
set customer_id = sub.customer_id
from (
  select distinct oi.order_id, oi.customer_id
  from order_items oi
  where oi.item_type = 'detection_session' and oi.customer_id is not null
) sub
where cr.trigger_type = 'introducer'
  and cr.source_transaction_type = 'order'
  and cr.source_transaction_id = sub.order_id
  and cr.customer_id is null;
