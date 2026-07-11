-- ============================================================================
-- Migration 006 — Commission rules can be flat-amount, and individual
-- commission_records can be manually overridden by admin/finance with an
-- audit trail. Run after migration 005.
-- ============================================================================

-- ---- commission_rules: percentage OR flat amount ----
alter table commission_rules add column if not exists calculation_type text not null default 'percentage';
alter table commission_rules add constraint chk_commission_rules_calculation_type
  check (calculation_type in ('percentage', 'flat'));
alter table commission_rules add column if not exists flat_amount numeric(12,2);
alter table commission_rules alter column rate_percent drop not null;
alter table commission_rules add constraint chk_commission_rule_calculation check (
  (calculation_type = 'percentage' and rate_percent is not null and flat_amount is null) or
  (calculation_type = 'flat' and flat_amount is not null and rate_percent is null)
);

-- ---- commission_records: record which calculation was used, plus the manual override trail ----
alter table commission_records add column if not exists calculation_type text not null default 'percentage';
alter table commission_records add constraint chk_commission_records_calculation_type
  check (calculation_type in ('percentage', 'flat'));
alter table commission_records alter column rate_applied drop not null;
alter table commission_records add column if not exists original_amount numeric(12,2);
alter table commission_records add column if not exists adjusted_by uuid references users(id);
alter table commission_records add column if not exists adjusted_at timestamptz;
alter table commission_records add column if not exists adjustment_reason text;

-- ---- replace get_active_rate() with get_active_rule() (returns the whole rule, not just a rate) ----
drop function if exists get_active_rate(text, int, date);

create function get_active_rule(p_trigger_type text, p_level int, p_as_of date default current_date)
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

-- ---- replace insert_commission() to compute from calculation_type + apply cap ----
drop function if exists insert_commission(text, uuid, int, uuid, uuid, numeric, numeric);

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

-- ---- replace the trigger function to call get_active_rule()/insert_commission() with the new signatures ----
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
  if tg_op = 'INSERT' then
    if new.status <> 'paid' then
      return new;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.status <> 'paid' or old.status = 'paid' then
      return new;
    end if;
  end if;

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

  if new.order_type <> 'detection_service' or new.analyst_id is null then
    return new;
  end if;

  select exists (
    select 1 from order_items where order_id = new.id and item_type = 'voucher_redemption'
  ) into v_has_voucher_item;

  if v_has_voucher_item then
    select * into v_rule from get_active_rule('voucher_resale', 0);
    if v_rule.calculation_type is null then
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
