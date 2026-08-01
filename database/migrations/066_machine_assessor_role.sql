-- ============================================================================
-- Migration 066 — Machine Assessor role (认证测试师)
--
-- New extra role, same shape as leader/pic (migration 004): granted on top
-- of an existing analyst login, never a login on its own. Gates the ability
-- to book/reserve a device from the general device-schedule page
-- (/admin/schedule) — everyone else with page access still sees machine
-- status/availability, just can't create a booking there.
-- ============================================================================

insert into roles (name, description) values
  ('machine_assessor', '认证测试师 — 可在设备排班页面预约/带出检测仪器，非此身份只能查看状态')
on conflict (name) do nothing;

create or replace function is_machine_assessor()
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
      and r.name = 'machine_assessor'
  )
$$;
