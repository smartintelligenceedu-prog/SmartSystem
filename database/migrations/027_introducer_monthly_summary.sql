-- ============================================================================
-- Migration 027 — Monthly breakdown RPC for the introducer self-service
-- dashboard (2026-07-14, CTO request): introducers want to see how many
-- customers they brought in and how much bonus they earned, per month.
--
-- Same privacy posture as the existing introducer_summary()/team_summary()
-- functions: aggregate-only, security definer, never exposes the underlying
-- customer rows or names — only a per-month count + bonus total. An
-- introducer may only query their own numbers; back office may query anyone's.
--
-- Self-contained + idempotent: create-or-replace function is always safe to
-- rerun.
-- ============================================================================

create or replace function introducer_monthly_summary(for_introducer_id uuid default null)
returns table (
  month date,
  new_customers bigint,
  bonus_total numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_id uuid := current_introducer_id();
  target_id uuid := coalesce(for_introducer_id, requester_id);
begin
  if requester_id is null and not is_back_office() then
    raise exception 'not authorized';
  end if;
  if not is_back_office() and target_id <> requester_id then
    raise exception 'not authorized to view this introducer''s summary';
  end if;

  return query
    with customer_months as (
      select date_trunc('month', created_at)::date as m, count(*) as cnt
      from customers
      where acquired_via_introducer_id = target_id
      group by 1
    ),
    bonus_months as (
      select date_trunc('month', calculated_at)::date as m, sum(commission_amount) as total
      from commission_records
      where introducer_id = target_id
      group by 1
    )
    select
      coalesce(cm.m, bm.m) as month,
      coalesce(cm.cnt, 0) as new_customers,
      coalesce(bm.total, 0) as bonus_total
    from customer_months cm
    full outer join bonus_months bm on cm.m = bm.m
    order by month desc;
end;
$$;

revoke all on function introducer_monthly_summary(uuid) from public;
grant execute on function introducer_monthly_summary(uuid) to authenticated;
