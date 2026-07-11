-- ============================================================================
-- TQC Business Management System — Commission Engine (v1.0)
-- Apply after schema.sql + rls_policies.sql.
--
-- Design note: the actual calculation runs as a Postgres trigger (not an Edge
-- Function) so it commits atomically with the order that caused it — an
-- order can never end up "paid" with no commission calculated, or vice
-- versa, because they're the same transaction. Edge Functions are reserved
-- for work that genuinely needs to live outside the database: the periodic
-- payout batch (settle-commissions Edge Function, see supabase/functions/).
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
-- Helper: look up the currently-effective rate for a trigger type + level.
-- Pulls from the active compensation plan; a missing rate means "don't pay
-- this level" rather than an error, so partial rule sets degrade safely.
-- ----------------------------------------------------------------------------

create or replace function get_active_rate(p_trigger_type text, p_level int, p_as_of date default current_date)
returns numeric
language sql stable
as $$
  select cr.rate_percent
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
-- Small insert helper so the branches below stay readable.
-- ----------------------------------------------------------------------------

create or replace function insert_commission(
  p_trigger_type text,
  p_order_id uuid,
  p_level int,
  p_analyst_id uuid,
  p_introducer_id uuid,
  p_rate numeric,
  p_base numeric
)
returns void
language sql
as $$
  insert into commission_records (
    trigger_type, source_transaction_type, source_transaction_id,
    level_number, analyst_id, introducer_id, rate_applied, base_amount, commission_amount
  ) values (
    p_trigger_type, 'order', p_order_id,
    p_level, p_analyst_id, p_introducer_id, p_rate, p_base, round(p_base * p_rate / 100, 2)
  )
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
  v_rate numeric;
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
      v_rate := get_active_rate('recruitment', i);
      if v_rate is not null then
        perform insert_commission('recruitment', new.id, i, v_sponsor, null, v_rate, new.total_amount);
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
    v_rate := coalesce(get_active_rate('voucher_resale', 0), 100);
    perform insert_commission('voucher_resale', new.id, 0, new.analyst_id, null, v_rate, new.total_amount);
    return new;
  end if;

  select acquired_via_campaign_id, acquired_via_introducer_id
    into v_campaign_id, v_introducer_id
  from customers where id = new.customer_id;

  -- Personal sale vs. PIC channel sale are mutually exclusive — PIC replaces
  -- the direct sponsor for that one sale, and neither cascades further.
  if v_campaign_id is not null then
    select pic_analyst_id into v_pic_analyst_id from channel_campaigns where id = v_campaign_id;
    v_rate := get_active_rate('pic_channel', 1);
    if v_pic_analyst_id is not null and v_rate is not null then
      perform insert_commission('pic_channel', new.id, 1, v_pic_analyst_id, null, v_rate, new.total_amount);
    end if;
  else
    v_sponsor := sponsor_at_level(new.analyst_id, 1);
    v_rate := get_active_rate('personal_sale', 1);
    if v_sponsor is not null and v_rate is not null then
      perform insert_commission('personal_sale', new.id, 1, v_sponsor, null, v_rate, new.total_amount);
    end if;
  end if;

  -- Introducer referral fee stacks on top of whichever rule fired above.
  if v_introducer_id is not null then
    v_rate := get_active_rate('introducer', 1);
    if v_rate is not null then
      perform insert_commission('introducer', new.id, 1, null, v_introducer_id, v_rate, new.total_amount);
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
-- ----------------------------------------------------------------------------
