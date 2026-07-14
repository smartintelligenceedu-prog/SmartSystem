-- ============================================================================
-- Migration 023 — Real ops config data for the device scheduling feature
-- (migrations 021/022): the CTO's actual location and device options,
-- replacing/extending the placeholder seeded in migration 021.
--
-- Self-contained + fully idempotent — see migration_idempotency_convention.
-- ============================================================================

-- Migration 021 seeded a single combined placeholder row; rename it to match
-- the real two-option naming ('Office' + '外访') rather than leaving stale
-- placeholder text live. No-op once already renamed (idempotent by nature —
-- the WHERE simply matches zero rows on a second run).
update detection_centers set name = '外访' where name = '到府/外访检测';

insert into detection_centers (name, status)
select 'Office', 'active'
where not exists (select 1 from detection_centers where name = 'Office');

insert into detection_centers (name, status)
select '外访', 'active'
where not exists (select 1 from detection_centers where name = '外访');

insert into devices (serial_no, status)
select 'SIXG105', 'active'
where not exists (select 1 from devices where serial_no = 'SIXG105');

insert into devices (serial_no, status)
select 'SIXG108', 'active'
where not exists (select 1 from devices where serial_no = 'SIXG108');

insert into devices (serial_no, status)
select 'SIXG110', 'active'
where not exists (select 1 from devices where serial_no = 'SIXG110');
