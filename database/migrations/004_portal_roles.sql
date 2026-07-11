-- ============================================================================
-- Migration 004 — Portal role system: Agent / Leader / Introducer / PIC
--
-- Additive only: new role catalog rows + two audit columns on user_roles.
-- No changes to analysts/introducers/customers/commission_records — all the
-- data those dashboards need (assigned_leader_id, sponsor_id, is_pic,
-- introducer_id on commission_records, acquired_via_introducer_id on
-- customers) already exists from the Registration Module.
-- ============================================================================

insert into roles (name, description) values
  ('agent', '分析师本人 — Registration Module 里的 analysts'),
  ('leader', '团队主管，可查看下线团队汇总（不含顾客明细）'),
  ('introducer', '外部引荐渠道，非分析师体系成员'),
  ('pic', '通路开发负责人（校园/机构/roadshow），未来启用')
on conflict (name) do nothing;

alter table user_roles add column if not exists granted_by uuid references users(id);
alter table user_roles add column if not exists granted_at timestamptz not null default now();

-- ============================================================================
-- Introducer login: introducers previously had zero self-access (they were
-- back-office-only, since nobody could log in as one). Give them the same
-- self-or-back-office SELECT pattern used everywhere else, and a matching
-- current_introducer_id() helper (SECURITY DEFINER for the same
-- circular-RLS reason documented in rls_policies.sql).
-- ============================================================================

create or replace function current_introducer_id()
returns uuid
language sql stable
security definer
set search_path = public
as $$
  select id from introducers where party_id = current_party_id()
$$;

drop policy if exists "back office only" on introducers;

alter table introducers enable row level security;

create policy "self or back office reads introducers" on introducers for select
  using (party_id = current_party_id() or is_back_office());
create policy "back office manages introducers" on introducers for insert with check (is_back_office());
create policy "back office updates introducers" on introducers for update using (is_back_office());

-- commission_records: extend the existing analyst-only SELECT policy to also
-- cover an introducer reading their own commission rows.
drop policy if exists "analyst reads own commission records, back office reads all" on commission_records;

create policy "self or back office reads commission records" on commission_records for select
  using (
    analyst_id = current_analyst_id()
    or introducer_id = current_introducer_id()
    or is_back_office()
  );

-- ============================================================================
-- Leader dashboard: extend team_summary() with team commission total and a
-- pending-approval count, and add team_members() for the per-agent breakdown
-- a Leader needs to actually manage their team (names/individual numbers —
-- not customer PII, which stays behind the aggregate-only rule).
-- ============================================================================

-- Team membership is assigned_leader_id, deliberately NOT the sponsor-based
-- downline_analyst_ids() used by the commission engine — those are two
-- independent relationships by design (see the Introducer-vs-Assigned-Leader
-- decision from the Registration Module). A Leader's team is flat: whoever
-- has assigned_leader_id = the leader's own analyst id. No multi-level
-- leader-of-leaders nesting — the spec says a Leader can't see other
-- Leaders' data, i.e. teams are siloed, not stacked.

-- Postgres won't let CREATE OR REPLACE change a function's return type, and
-- this call is adding two columns to what rls_policies.sql originally defined.
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
        where cr.analyst_id in (select id from analysts where assigned_leader_id = target_id)
      ), 0),
      count(distinct a.id) filter (where a.status = 'pending')
    from analysts a
    left join customers c on c.owner_analyst_id = a.id
    left join detection_sessions s on s.analyst_id = a.id
    left join orders o on o.analyst_id = a.id
    where a.assigned_leader_id = target_id;
end;
$$;

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
      count(distinct c.id),
      coalesce(sum(o.total_amount) filter (where o.status = 'paid'), 0)
    from analysts a
    left join individuals i on i.party_id = a.party_id
    left join customers c on c.owner_analyst_id = a.id
    left join orders o on o.analyst_id = a.id
    where a.assigned_leader_id = target_id
    group by a.id, i.full_name, a.status
    order by revenue desc;
end;
$$;

revoke all on function team_summary(uuid) from public;
grant execute on function team_summary(uuid) to authenticated;
revoke all on function team_members(uuid) from public;
grant execute on function team_members(uuid) to authenticated;

-- ============================================================================
-- Introducer dashboard: aggregate-only, same reasoning as team_summary — an
-- introducer sees totals, never the underlying customer rows.
-- ============================================================================

create or replace function introducer_summary(for_introducer_id uuid default null)
returns table (
  total_introduced_customers bigint,
  total_bonus numeric,
  pending_bonus numeric,
  paid_bonus numeric
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
    select
      (select count(*) from customers where acquired_via_introducer_id = target_id),
      coalesce((select sum(commission_amount) from commission_records where introducer_id = target_id), 0),
      coalesce((select sum(commission_amount) from commission_records where introducer_id = target_id and status = 'pending'), 0),
      coalesce((select sum(commission_amount) from commission_records where introducer_id = target_id and status = 'paid'), 0);
end;
$$;

revoke all on function introducer_summary(uuid) from public;
grant execute on function introducer_summary(uuid) to authenticated;
