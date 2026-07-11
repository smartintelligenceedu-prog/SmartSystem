-- ============================================================================
-- Migration 007 — Fix JOIN fan-out in team_summary() / team_members()
--
-- Bug: both functions LEFT JOINed customers, detection_sessions, and orders
-- independently from the same analysts row in a single query. With N
-- customers and M orders for the same analyst, that join produces N×M rows
-- (a cartesian product between the two independent one-to-many
-- relationships), so sum(orders.total_amount) was multiplied by the
-- customer count. COUNT(DISTINCT ...) happened to mask this for the count
-- columns, but SUM has no such protection. Observed: 2 customers × RM450
-- actual orders = RM900 shown on the Leader dashboard.
--
-- Fix: replace the multi-join with independent scalar/correlated subqueries
-- per metric, so no relationship can fan out against another.
-- ============================================================================

drop function if exists team_summary(uuid);

create function team_summary(for_analyst_id uuid default null)
returns table (
  analyst_count bigint,
  customer_count bigint,
  session_count bigint,
  total_revenue numeric,
  team_commission_total numeric,
  pending_team_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_id uuid := current_analyst_id();
  target_id uuid := coalesce(for_analyst_id, requester_id);
begin
  if requester_id is null and not is_back_office() then
    raise exception 'not authorized';
  end if;
  if not is_back_office() and target_id <> requester_id then
    raise exception 'not authorized to view this analyst''s team summary';
  end if;

  return query
    select
      (select count(*) from analysts where assigned_leader_id = target_id),
      (select count(*) from customers
         where owner_analyst_id in (select id from analysts where assigned_leader_id = target_id)),
      (select count(*) from detection_sessions
         where analyst_id in (select id from analysts where assigned_leader_id = target_id)),
      coalesce((select sum(total_amount) from orders
         where analyst_id in (select id from analysts where assigned_leader_id = target_id) and status = 'paid'), 0),
      coalesce((select sum(commission_amount) from commission_records
         where analyst_id = target_id
            or analyst_id in (select id from analysts where assigned_leader_id = target_id)), 0),
      (select count(*) from analysts where assigned_leader_id = target_id and status = 'pending');
end;
$$;

revoke all on function team_summary(uuid) from public;
grant execute on function team_summary(uuid) to authenticated;

drop function if exists team_members(uuid);

create function team_members(for_analyst_id uuid default null)
returns table (
  analyst_id uuid,
  full_name text,
  status text,
  customer_count bigint,
  revenue numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_id uuid := current_analyst_id();
  target_id uuid := coalesce(for_analyst_id, requester_id);
begin
  if requester_id is null and not is_back_office() then
    raise exception 'not authorized';
  end if;
  if not is_back_office() and target_id <> requester_id then
    raise exception 'not authorized to view this analyst''s team';
  end if;

  return query
    select
      a.id,
      coalesce(i.full_name, '—'),
      a.status,
      (select count(*) from customers c where c.owner_analyst_id = a.id),
      coalesce((select sum(o.total_amount) from orders o where o.analyst_id = a.id and o.status = 'paid'), 0)
    from analysts a
    left join individuals i on i.party_id = a.party_id
    where a.assigned_leader_id = target_id
    order by 5 desc;
end;
$$;

revoke all on function team_members(uuid) from public;
grant execute on function team_members(uuid) to authenticated;
