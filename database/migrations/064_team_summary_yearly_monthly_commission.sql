-- Same treatment as migration 063's yearly/monthly revenue, applied to team
-- commission: adds yearly_team_commission/monthly_team_commission to
-- team_summary() so the Leader dashboard can show "Overall Team
-- Commission" (existing all-time team_commission_total, unchanged),
-- "Yearly Team Commission" (current calendar year), and "Monthly Team
-- Commission" (current calendar month).
drop function if exists team_summary(uuid);

create function team_summary(for_analyst_id uuid default null)
returns table (
  analyst_count bigint,
  customer_count bigint,
  session_count bigint,
  total_revenue numeric,
  yearly_revenue numeric,
  monthly_revenue numeric,
  team_commission_total numeric,
  yearly_team_commission numeric,
  monthly_team_commission numeric,
  pending_team_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_id uuid := current_analyst_id();
  target_id uuid := coalesce(for_analyst_id, requester_id);
  v_year_start timestamptz := date_trunc('year', now());
  v_month_start timestamptz := date_trunc('month', now());
begin
  if requester_id is null and not is_back_office() then
    raise exception 'not authorized';
  end if;
  if not is_back_office() and target_id <> requester_id then
    raise exception 'not authorized to view this analyst''s team summary';
  end if;

  -- Independent scalar subqueries per metric, not a multi-table LEFT JOIN —
  -- joining customers, detection_sessions, and orders from the same
  -- analysts row in one query fans out into a cartesian product between
  -- those independent one-to-many relationships (N customers × M orders =
  -- N×M rows), which silently multiplies SUM(orders.total_amount). COUNT
  -- (DISTINCT ...) happens to mask this for the count columns, but SUM has
  -- no equivalent protection.
  return query
    select
      (select count(*) from analysts where assigned_leader_id = target_id),
      (select count(*) from customers
         where owner_analyst_id in (select id from analysts where assigned_leader_id = target_id)),
      (select count(*) from detection_sessions
         where analyst_id in (select id from analysts where assigned_leader_id = target_id)),
      coalesce((select sum(total_amount) from orders
         where analyst_id in (select id from analysts where assigned_leader_id = target_id) and status = 'paid'), 0),
      coalesce((select sum(total_amount) from orders
         where analyst_id in (select id from analysts where assigned_leader_id = target_id) and status = 'paid' and created_at >= v_year_start), 0),
      coalesce((select sum(total_amount) from orders
         where analyst_id in (select id from analysts where assigned_leader_id = target_id) and status = 'paid' and created_at >= v_month_start), 0),
      coalesce((
        -- Team Commission includes the leader's OWN commission_records, not
        -- just team members' — sponsor/leader-type commission is credited
        -- to the leader's analyst_id, so excluding it would show RM 0.00
        -- even when the team is actively generating revenue.
        select sum(commission_amount) from commission_records
        where analyst_id = target_id
           or analyst_id in (select id from analysts where assigned_leader_id = target_id)
      ), 0),
      coalesce((
        select sum(commission_amount) from commission_records
        where (analyst_id = target_id
           or analyst_id in (select id from analysts where assigned_leader_id = target_id))
          and calculated_at >= v_year_start
      ), 0),
      coalesce((
        select sum(commission_amount) from commission_records
        where (analyst_id = target_id
           or analyst_id in (select id from analysts where assigned_leader_id = target_id))
          and calculated_at >= v_month_start
      ), 0),
      (select count(*) from analysts where assigned_leader_id = target_id and status = 'pending');
end;
$$;

-- Dropping and recreating the function resets its grants to the Postgres
-- default (PUBLIC gets implicit EXECUTE) — reapply the original posture.
revoke all on function team_summary(uuid) from public;
grant execute on function team_summary(uuid) to authenticated;
