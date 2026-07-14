-- ============================================================================
-- TQC Business Management System — Row Level Security (v1.0)
-- Apply after schema.sql. Implements three access patterns:
--   1. Self-scope   — an analyst sees only what they own (customers, sessions, commissions)
--   2. Aggregate-only Leader/Introducer view — via SECURITY DEFINER RPC, never raw rows
--   3. Back-office  — full access for admin/finance roles
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper functions
--
-- All four are SECURITY DEFINER on purpose. Every one of them queries a
-- table that itself carries an RLS policy calling back into one of these
-- functions (users, analysts, user_roles) — under normal SECURITY INVOKER
-- semantics that's circular (the helper's own internal query would be
-- filtered by the policy that is currently evaluating, which calls the
-- helper again). SECURITY DEFINER makes the helper's internal lookup an
-- authoritative, RLS-bypassing read, which is what breaks the cycle. This
-- is the standard pattern for identity/role-check helpers in Postgres RLS,
-- not a workaround specific to this schema.
-- ----------------------------------------------------------------------------

create or replace function current_party_id()
returns uuid
language sql stable
security definer
set search_path = public
as $$
  select party_id from users where auth_user_id = auth.uid()
$$;

create or replace function current_analyst_id()
returns uuid
language sql stable
security definer
set search_path = public
as $$
  select id from analysts where party_id = current_party_id()
$$;

create or replace function current_introducer_id()
returns uuid
language sql stable
security definer
set search_path = public
as $$
  select id from introducers where party_id = current_party_id()
$$;

create or replace function is_back_office()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from user_roles ur
    join roles r on r.id = ur.role_id
    join users u on u.id = ur.user_id
    where u.auth_user_id = auth.uid()
      and r.name in ('admin', 'finance', 'back_office')
  )
$$;

-- Recursive downline lookup (excludes root_id itself)
create or replace function downline_analyst_ids(root_id uuid)
returns table(id uuid)
language sql stable
security definer
set search_path = public
as $$
  with recursive tree as (
    select a.id from analysts a where a.id = root_id
    union all
    select a.id from analysts a
    join tree t on a.sponsor_id = t.id
  )
  select id from tree where id <> root_id
$$;

-- ----------------------------------------------------------------------------
-- CRM: customers — self-scope only. No upline SELECT policy exists on this
-- table on purpose; upline visibility is aggregate-only via team_summary().
-- ----------------------------------------------------------------------------

alter table customers enable row level security;

create policy "analyst reads own customers, back office reads all"
  on customers for select
  using (owner_analyst_id = current_analyst_id() or is_back_office());

create policy "analyst writes own customers, back office writes all"
  on customers for insert
  with check (owner_analyst_id = current_analyst_id() or is_back_office());

create policy "analyst updates own customers, back office updates all"
  on customers for update
  using (owner_analyst_id = current_analyst_id() or is_back_office());

-- Introducer visibility (added for Customer Management, migration 011) —
-- an introducer sees only the customers they referred. Leader visibility
-- deliberately stays aggregate-only per the original decision above (no
-- policy added here for leaders).
create policy "introducer reads own referred customers" on customers for select
  using (acquired_via_introducer_id = current_introducer_id());

alter table customer_children enable row level security;

create policy "analyst reads own customers' children, back office reads all"
  on customer_children for select
  using (
    is_back_office()
    or exists (select 1 from customers c where c.id = customer_children.customer_id and c.owner_analyst_id = current_analyst_id())
    or exists (select 1 from customers c where c.id = customer_children.customer_id and c.acquired_via_introducer_id = current_introducer_id())
  );

create policy "back office writes customer children" on customer_children for insert with check (is_back_office());
create policy "back office updates customer children" on customer_children for update using (is_back_office());

-- tqc_one_page_reports (migration 020, replacing the abandoned
-- tqc_reports/migration 019): same read posture as customer_children
-- (owning analyst / referring introducer / back office). Write RLS is
-- back-office-only, same conservative default as customer_children — the
-- owning analyst can still write via the Server Action's own permission
-- check + admin client, same pattern as every other mutation in this app.
alter table tqc_one_page_reports enable row level security;

create policy "analyst reads own customers' children one-page reports, back office reads all"
  on tqc_one_page_reports for select
  using (
    is_back_office()
    or exists (
      select 1 from customer_children cc
      join customers c on c.id = cc.customer_id
      where cc.id = tqc_one_page_reports.child_id and c.owner_analyst_id = current_analyst_id()
    )
    or exists (
      select 1 from customer_children cc
      join customers c on c.id = cc.customer_id
      where cc.id = tqc_one_page_reports.child_id and c.acquired_via_introducer_id = current_introducer_id()
    )
    -- Migration 028 — same read posture, but for reports where the customer
    -- themselves (not a child) is the subject.
    or exists (
      select 1 from customers c
      where c.id = tqc_one_page_reports.customer_id and c.owner_analyst_id = current_analyst_id()
    )
    or exists (
      select 1 from customers c
      where c.id = tqc_one_page_reports.customer_id and c.acquired_via_introducer_id = current_introducer_id()
    )
  );

create policy "back office writes tqc one-page reports" on tqc_one_page_reports for insert with check (is_back_office());
create policy "back office updates tqc one-page reports" on tqc_one_page_reports for update using (is_back_office());

alter table interactions enable row level security;

create policy "analyst reads interactions on own customers"
  on interactions for select
  using (
    is_back_office()
    or exists (
      select 1 from customers c
      where c.id = interactions.customer_id
        and c.owner_analyst_id = current_analyst_id()
    )
  );

-- ----------------------------------------------------------------------------
-- Detection sessions / appointments (migration 021) — readable by ANY
-- authenticated portal user, not just the performing analyst. This is a
-- deliberate departure from this file's original own-records-only draft:
-- the whole point of the shared device schedule view is letting every
-- analyst see who's booked what, so they can coordinate and avoid double-
-- booking a device — that's impossible if each analyst can only see their
-- own bookings. Writes stay back-office-only by policy; the Server Action's
-- app layer additionally allows the child's owning analyst via the admin
-- client, matching the report-entry permission convention.
-- ----------------------------------------------------------------------------

alter table detection_appointments enable row level security;

create policy "authenticated can read appointments"
  on detection_appointments for select
  using (auth.role() = 'authenticated');

create policy "back office writes appointments"
  on detection_appointments for insert
  with check (is_back_office());

create policy "back office updates appointments"
  on detection_appointments for update
  using (is_back_office());

alter table detection_sessions enable row level security;

create policy "authenticated can read sessions"
  on detection_sessions for select
  using (auth.role() = 'authenticated');

create policy "back office writes sessions"
  on detection_sessions for insert
  with check (is_back_office());

-- ----------------------------------------------------------------------------
-- Commission records — the payee (analyst or introducer) sees only their own
-- rows; back office sees all.
-- ----------------------------------------------------------------------------

alter table commission_records enable row level security;

create policy "self or back office reads commission records"
  on commission_records for select
  using (
    analyst_id = current_analyst_id()
    or introducer_id = current_introducer_id()
    or is_back_office()
  );

-- ----------------------------------------------------------------------------
-- Commission payout automation (migration 022) — same self-or-back-office
-- read shape as commission_records itself; only back office ever writes.
-- ----------------------------------------------------------------------------

alter table commission_payout_runs enable row level security;
create policy "back office manages payout runs" on commission_payout_runs for all
  using (is_back_office()) with check (is_back_office());

alter table analyst_payslips enable row level security;
create policy "analyst reads own payslips, back office reads all" on analyst_payslips for select
  using (analyst_id = current_analyst_id() or is_back_office());
create policy "back office writes payslips" on analyst_payslips for insert
  with check (is_back_office());

alter table introducer_commission_statements enable row level security;
create policy "introducer reads own statements, back office reads all" on introducer_commission_statements for select
  using (introducer_id = current_introducer_id() or is_back_office());
create policy "back office writes statements" on introducer_commission_statements for insert
  with check (is_back_office());

-- ----------------------------------------------------------------------------
-- Devices (migration 021) — readable by any authenticated portal user, same
-- reasoning as detection_appointments/detection_sessions above: the device
-- picker on the detection entry form and the shared schedule view both need
-- to see the full active device list, not just "my assigned device". Writes
-- (adding/editing devices) stay back-office-only.
-- ----------------------------------------------------------------------------

alter table devices enable row level security;

create policy "authenticated can read devices"
  on devices for select
  using (auth.role() = 'authenticated');

create policy "back office manages devices"
  on devices for all
  using (is_back_office())
  with check (is_back_office());

-- ----------------------------------------------------------------------------
-- Analysts table — an analyst can read their own record and their direct
-- downline's basic profile (name/rank/status), not full party details.
-- ----------------------------------------------------------------------------

alter table analysts enable row level security;

create policy "analyst reads self, direct downline, or back office reads all"
  on analysts for select
  using (
    id = current_analyst_id()
    or sponsor_id = current_analyst_id()
    or is_back_office()
  );

-- ----------------------------------------------------------------------------
-- Everything else that is purely internal back-office (Finance, HR,
-- Procurement, system tables): same pattern, one policy per table.
-- Analysts have no direct access; only is_back_office() roles do.
-- ----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'invoices', 'payments', 'receipts', 'institutional_vouchers', 'chart_of_accounts', 'journal_entries', 'journal_lines',
    'suppliers', 'purchase_orders', 'po_items', 'consumable_items', 'stock_movements',
    'employees', 'attendance', 'leave_requests', 'payroll_runs', 'payslips',
    'audit_logs', 'settings', 'registration_orders', 'sales_orders',
    'compensation_plans', 'commission_rules'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "back office only" on %I for all using (is_back_office()) with check (is_back_office())',
      t
    );
  end loop;
end;
$$;

-- introducers: unlike the tables above, an introducer can log in and needs
-- to read their own row (self-or-back-office), not back-office-only.
alter table introducers enable row level security;
create policy "self or back office reads introducers" on introducers for select
  using (party_id = current_party_id() or is_back_office());
create policy "back office manages introducers" on introducers for insert with check (is_back_office());
create policy "back office updates introducers" on introducers for update using (is_back_office());

-- ----------------------------------------------------------------------------
-- Remaining tables that were left without RLS above. Without an explicit
-- policy, Supabase's auto-generated API would expose these completely
-- unrestricted to anyone with an API key — that includes PII (parties,
-- individuals, organizations, addresses) and financial data (orders,
-- order_items) — so none of these can be skipped before going live.
-- ----------------------------------------------------------------------------

-- PII: back office manages all; a user may read their own party record.
alter table parties enable row level security;
alter table individuals enable row level security;
alter table organizations enable row level security;
alter table addresses enable row level security;

create policy "self or back office" on parties for select
  using (id = current_party_id() or is_back_office());
create policy "back office writes parties" on parties for insert with check (is_back_office());
create policy "back office updates parties" on parties for update using (is_back_office());

create policy "self or back office" on individuals for select
  using (party_id = current_party_id() or is_back_office());
create policy "back office writes individuals" on individuals for insert with check (is_back_office());
create policy "back office updates individuals" on individuals for update using (is_back_office());

create policy "self or back office" on organizations for select
  using (party_id = current_party_id() or is_back_office());
create policy "back office manages organizations" on organizations for all using (is_back_office());

create policy "self or back office" on addresses for select
  using (party_id = current_party_id() or is_back_office());
create policy "back office manages addresses" on addresses for all using (is_back_office());

-- users / roles / user_roles: a user reads their own row; role management is back office.
alter table users enable row level security;
alter table roles enable row level security;
alter table user_roles enable row level security;

create policy "self or back office" on users for select
  using (auth_user_id = auth.uid() or is_back_office());
create policy "back office manages users" on users for all using (is_back_office());

create policy "authenticated can read role catalog" on roles for select
  using (auth.role() = 'authenticated');
create policy "back office manages roles" on roles for all using (is_back_office());

create policy "self or back office" on user_roles for select
  using (
    is_back_office()
    or user_id in (select id from users where auth_user_id = auth.uid())
  );
create policy "back office manages user_roles" on user_roles for insert with check (is_back_office());
create policy "back office updates user_roles" on user_roles for delete using (is_back_office());

-- orders / order_items: an analyst sees their own sales; back office sees all.
alter table orders enable row level security;
alter table order_items enable row level security;

create policy "analyst reads own orders, back office reads all" on orders for select
  using (analyst_id = current_analyst_id() or is_back_office());
create policy "analyst creates own orders, back office creates all" on orders for insert
  with check (analyst_id = current_analyst_id() or is_back_office());
create policy "back office updates orders" on orders for update using (is_back_office());

create policy "analyst reads own order items, back office reads all" on order_items for select
  using (
    is_back_office()
    or exists (select 1 from orders o where o.id = order_items.order_id and o.analyst_id = current_analyst_id())
  );

-- Multi-person orders (migration 012): a different family member's item can
-- be credited to a different agent than whoever submitted the order, so
-- that agent needs to see the item (and the order it belongs to) even
-- though they're not orders.analyst_id.
create policy "analyst reads own assigned order items" on order_items for select
  using (analyst_id = current_analyst_id());

-- SECURITY DEFINER wrapper (migration 013 fix) — a plain correlated
-- subquery on order_items here would recurse: the order_items policy above
-- queries orders, and this orders policy would query order_items, forever.
-- The function's internal query runs as the bypassing owner role instead of
-- re-triggering order_items' RLS, which breaks the cycle — same pattern as
-- current_analyst_id() / is_back_office() elsewhere in this file.
create or replace function analyst_has_item_in_order(p_order_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from order_items oi where oi.order_id = p_order_id and oi.analyst_id = current_analyst_id()
  )
$$;
revoke all on function analyst_has_item_in_order(uuid) from public;
grant execute on function analyst_has_item_in_order(uuid) to authenticated;

create policy "analyst reads orders containing their assigned items" on orders for select
  using (analyst_has_item_in_order(orders.id));

-- channel_campaigns: any authenticated analyst can see the campaign catalog
-- (needed to attribute a customer at signup time); only back office / the
-- assigned PIC manage it.
alter table channel_campaigns enable row level security;
create policy "authenticated can read campaigns" on channel_campaigns for select
  using (auth.role() = 'authenticated');
create policy "pic or back office manages campaign" on channel_campaigns for update
  using (pic_analyst_id = current_analyst_id() or is_back_office());
create policy "back office creates campaigns" on channel_campaigns for insert
  with check (is_back_office());

-- leads: assigned analyst only, back office sees all.
alter table leads enable row level security;
create policy "analyst reads assigned leads, back office reads all" on leads for select
  using (assigned_analyst_id = current_analyst_id() or is_back_office());
create policy "analyst manages assigned leads, back office manages all" on leads for all
  using (assigned_analyst_id = current_analyst_id() or is_back_office())
  with check (assigned_analyst_id = current_analyst_id() or is_back_office());

-- customer_ownership_history / customer_consents: tied to customer ownership.
alter table customer_ownership_history enable row level security;
alter table customer_consents enable row level security;

create policy "owner or back office" on customer_ownership_history for select
  using (
    is_back_office()
    or exists (select 1 from customers c where c.id = customer_ownership_history.customer_id and c.owner_analyst_id = current_analyst_id())
  );
create policy "back office writes ownership history" on customer_ownership_history for insert with check (is_back_office());

create policy "owner or back office" on customer_consents for select
  using (
    is_back_office()
    or exists (select 1 from customers c where c.id = customer_consents.customer_id and c.owner_analyst_id = current_analyst_id())
  );
create policy "owner records consent, back office records all" on customer_consents for insert
  with check (
    is_back_office()
    or exists (select 1 from customers c where c.id = customer_consents.customer_id and c.owner_analyst_id = current_analyst_id())
  );

-- Catalog / reference data: read-only to any authenticated user, writes are back office.
do $$
declare
  t text;
begin
  foreach t in array array['branches', 'detection_centers', 'analyst_ranks', 'training_courses', 'certification_exams', 'registration_kits']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "authenticated can read" on %I for select using (auth.role() = ''authenticated'')', t);
    execute format('create policy "back office writes" on %I for insert with check (is_back_office())', t);
    execute format('create policy "back office updates" on %I for update using (is_back_office())', t);
  end loop;
end;
$$;

-- Analyst's own training / certification / voucher / business-card records.
do $$
declare
  t text;
begin
  foreach t in array array['training_enrollments', 'certification_records', 'detection_vouchers', 'business_card_orders']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "analyst reads own, back office reads all" on %I for select using (analyst_id = current_analyst_id() or is_back_office())',
      t
    );
    execute format('create policy "back office manages" on %I for insert with check (is_back_office())', t);
    execute format('create policy "back office updates" on %I for update using (is_back_office())', t);
  end loop;
end;
$$;

-- Device history tables: internal only — analysts see the device's current
-- state via the devices table policy above, not its full assignment/maintenance history.
do $$
declare
  t text;
begin
  foreach t in array array['device_assignments', 'device_maintenance_logs', 'device_incidents']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "back office only" on %I for all using (is_back_office()) with check (is_back_office())', t);
  end loop;
end;
$$;

alter table notifications enable row level security;
create policy "back office only" on notifications for all using (is_back_office()) with check (is_back_office());

-- ============================================================================
-- Aggregate-only Leader team view
-- Runs as SECURITY DEFINER so it can read across the whole team, but only
-- ever returns summed numbers or per-member totals — never a customer row.
-- This is the entire enforcement mechanism for "Leader sees team numbers,
-- not customer names".
--
-- Team membership is assigned_leader_id — deliberately NOT the sponsor-based
-- downline_analyst_ids() used by the commission engine. Those are two
-- independent relationships by design (see the Introducer-vs-Assigned-Leader
-- decision in the Registration Module). Teams are also flat: a Leader can't
-- see another Leader's team, and there's no leader-of-leaders nesting.
-- ============================================================================

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
      coalesce((
        -- Team Commission includes the leader's OWN commission_records, not
        -- just team members' — sponsor/leader-type commission is credited
        -- to the leader's analyst_id, so excluding it would show RM 0.00
        -- even when the team is actively generating revenue.
        select sum(commission_amount) from commission_records
        where analyst_id = target_id
           or analyst_id in (select id from analysts where assigned_leader_id = target_id)
      ), 0),
      (select count(*) from analysts where assigned_leader_id = target_id and status = 'pending');
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

  -- Correlated subqueries per analyst row (scoped to a.id) instead of a
  -- second-level join, for the same fan-out reason as team_summary() above.
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

revoke all on function team_summary(uuid) from public;
grant execute on function team_summary(uuid) to authenticated;
revoke all on function team_members(uuid) from public;
grant execute on function team_members(uuid) to authenticated;

-- ============================================================================
-- Aggregate-only Introducer view — same reasoning as team_summary: an
-- introducer sees totals, never the underlying customer rows.
-- ============================================================================

create function introducer_summary(for_introducer_id uuid default null)
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

-- Migration 027 — same aggregate-only posture as introducer_summary() above,
-- but broken down per month (new customer count + bonus total) for the
-- introducer self-service dashboard's monthly history view.
create function introducer_monthly_summary(for_introducer_id uuid default null)
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
