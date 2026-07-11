-- ============================================================================
-- Migration 005 — Fix team_summary()'s Team Commission calculation
--
-- Bug: the original query only summed commission_records where
-- analyst_id is a TEAM MEMBER. But sponsor/leader-type commission (personal_sale,
-- recruitment, pic_channel) is credited to the LEADER's own analyst_id, not
-- the team member who generated it — that's the whole point of a
-- commission engine ("the sale generates an override for upline"). So the
-- original query excluded exactly the money that normally flows through
-- this path, and "Team Commission" showed RM 0.00 even when the team was
-- actively generating revenue and commission.
--
-- Fix: Team Commission = commission credited to the leader themselves OR
-- any of their team members — a superset of "Override Summary" (the
-- leader's own payout alone), covering the case where a team member also
-- has their own downline generating commission credited to that member.
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
      count(distinct a.id),
      count(distinct c.id),
      count(distinct s.id),
      coalesce(sum(o.total_amount) filter (where o.status = 'paid'), 0),
      coalesce((
        select sum(cr.commission_amount) from commission_records cr
        where cr.analyst_id = target_id
           or cr.analyst_id in (select id from analysts where assigned_leader_id = target_id)
      ), 0),
      count(distinct a.id) filter (where a.status = 'pending')
    from analysts a
    left join customers c on c.owner_analyst_id = a.id
    left join detection_sessions s on s.analyst_id = a.id
    left join orders o on o.analyst_id = a.id
    where a.assigned_leader_id = target_id;
end;
$$;

revoke all on function team_summary(uuid) from public;
grant execute on function team_summary(uuid) to authenticated;
