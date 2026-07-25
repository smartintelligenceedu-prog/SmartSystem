-- Migration 042: let an analyst block out a device/time slot for a
-- booth/roadshow/school visit without tying it to any real customer yet —
-- a pure placeholder on the shared timeline so other analysts see the
-- device is unavailable, not a real Stage 1 booking. Walk-ins during that
-- event are still booked individually (with a real or newly-created
-- customer) via scheduleAppointment()/scheduleAppointmentForNewCustomer();
-- this is only for reserving the device itself in advance.
--
-- customer_id must become nullable for this — it stays not-null-in-practice
-- for every other status. The device-conflict GiST exclusion constraint
-- (device_id, time_range) is untouched by this and keeps protecting a
-- booth_reserved slot exactly like a real appointment: nobody can
-- double-book the same device for an overlapping time either way.
alter table detection_appointments alter column customer_id drop not null;

do $$
declare
  con record;
begin
  for con in
    select c.conname, c.conrelid::regclass::text as tbl
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    where rel.relname = 'detection_appointments'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%status%'
  loop
    execute format('alter table %s drop constraint %I', con.tbl, con.conname);
  end loop;
end;
$$;

alter table detection_appointments add constraint detection_appointments_status_check
  check (status in ('booked', 'confirmed', 'pending_assessment', 'completed', 'cancelled', 'no_show', 'booth_reserved'));

-- customer_id is null only for 'booth_reserved' rows — every other status
-- must still have a real customer, matching the not-null behavior these
-- rows had before this migration.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'detection_appointments_customer_required_unless_booth'
  ) then
    alter table detection_appointments add constraint detection_appointments_customer_required_unless_booth
      check (customer_id is not null or status = 'booth_reserved');
  end if;
end;
$$;
