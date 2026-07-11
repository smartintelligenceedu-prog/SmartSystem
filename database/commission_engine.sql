-- ============================================================================
-- TQC Business Management System — Commission Engine (v1.1)
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
-- Main trigger function — fires when an order transitions into 'paid'.
-- ----------------------------------------------------------------------------

-- security definer: this function reads commission_rules, channel_campaigns
-- and writes commission_records — all of which are RLS-restricted to back
-- office. Without security definer, this trigger would silently compute
-- zero commissions whenever a regular analyst session (not back office)
-- causes the order to become 'paid'.
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
  v_has_voucher_item boolean;
  v_campaign_id uuid;
  v_pic_analyst_id uuid;
  v_introducer_id uuid;
  i int;
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

  -- ---- Registration order: 3-level recruitment commission ----
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

  -- ---- Detection service order ----
  if new.order_type <> 'detection_service' or new.analyst_id is null then
    return new;
  end if;

  -- Voucher redemption sales are terminal: 100% to the redeeming analyst, no cascade.
  select exists (
    select 1 from order_items where order_id = new.id and item_type = 'voucher_redemption'
  ) into v_has_voucher_item;

  if v_has_voucher_item then
    select * into v_rule from get_active_rule('voucher_resale', 0);
    if v_rule.calculation_type is null then
      -- fall back to the "100% to self" default if nobody has configured this rule yet
      perform insert_commission('voucher_resale', new.id, 0, new.analyst_id, null, 'percentage', 100, null, null, new.total_amount);
    else
      perform insert_commission(
        'voucher_resale', new.id, 0, new.analyst_id, null,
        v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, new.total_amount
      );
    end if;
    return new;
  end if;

  select acquired_via_campaign_id, acquired_via_introducer_id
    into v_campaign_id, v_introducer_id
  from customers where id = new.customer_id;

  -- Personal sale vs. PIC channel sale are mutually exclusive — PIC replaces
  -- the direct sponsor for that one sale, and neither cascades further.
  if v_campaign_id is not null then
    select pic_analyst_id into v_pic_analyst_id from channel_campaigns where id = v_campaign_id;
    select * into v_rule from get_active_rule('pic_channel', 1);
    if v_pic_analyst_id is not null and v_rule.calculation_type is not null then
      perform insert_commission(
        'pic_channel', new.id, 1, v_pic_analyst_id, null,
        v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, new.total_amount
      );
    end if;
  else
    v_sponsor := sponsor_at_level(new.analyst_id, 1);
    select * into v_rule from get_active_rule('personal_sale', 1);
    if v_sponsor is not null and v_rule.calculation_type is not null then
      perform insert_commission(
        'personal_sale', new.id, 1, v_sponsor, null,
        v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, new.total_amount
      );
    end if;
  end if;

  -- Introducer referral fee stacks on top of whichever rule fired above.
  if v_introducer_id is not null then
    select * into v_rule from get_active_rule('introducer', 1);
    if v_rule.calculation_type is not null then
      perform insert_commission(
        'introducer', new.id, 1, null, v_introducer_id,
        v_rule.calculation_type, v_rule.rate_percent, v_rule.flat_amount, v_rule.cap_amount, new.total_amount
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_calculate_commissions on orders;
create trigger trg_calculate_commissions
  after insert or update of status on orders
  for each row
  execute function calculate_commissions_for_order();

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
