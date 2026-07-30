-- Migration 052: manual sponsor reassignment + auto re-parent on suspend.
--
-- Two related capabilities (both explicit product decisions):
--
-- 1. admin_reassign_analyst_sponsor() — back office can move any analyst to
--    report to a different sponsor at any time (analysts.sponsor_id was
--    previously write-once at registration, with no edit path anywhere).
--    Cycle-guarded: refuses to attach an analyst under their own descendant.
--
-- 2. admin_set_analyst_suspend_status() — replaces the plain UPDATE that
--    used to live in the app layer. Suspending an analyst now automatically
--    re-parents their DIRECT downlines to the suspended analyst's own
--    sponsor (skip-over), so the 3-level recruitment commission chain
--    (sponsor_at_level(), commission_engine.sql) doesn't keep resolving to a
--    suspended account going forward. Resuming (un-suspending) later does
--    NOT auto-revert this — re-parenting is a one-way, admin-visible action;
--    silently moving people again on resume would be more surprising than
--    helpful. Both directions only touch analysts.sponsor_id — every
--    commission_records row already written stays exactly as calculated,
--    matching this project's "never rewrite historical financial records"
--    convention (same principle as migrations 049-051).

create or replace function admin_reassign_analyst_sponsor(p_analyst_id uuid, p_new_sponsor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_walk uuid;
begin
  if p_new_sponsor_id is not null then
    if p_new_sponsor_id = p_analyst_id then
      raise exception 'an analyst cannot be their own sponsor';
    end if;
    if not exists (select 1 from analysts where id = p_new_sponsor_id) then
      raise exception 'new sponsor % not found', p_new_sponsor_id;
    end if;
    -- Cycle guard: walk UP from the proposed new sponsor. If that walk ever
    -- reaches p_analyst_id, the proposed sponsor is actually p_analyst_id's
    -- own descendant, and attaching would create a loop.
    v_walk := p_new_sponsor_id;
    while v_walk is not null loop
      if v_walk = p_analyst_id then
        raise exception 'cannot reassign: % is a descendant of %, this would create a cycle', p_new_sponsor_id, p_analyst_id;
      end if;
      select sponsor_id into v_walk from analysts where id = v_walk;
    end loop;
  end if;

  update analysts set sponsor_id = p_new_sponsor_id, updated_at = now() where id = p_analyst_id;
end;
$$;

create or replace function admin_set_analyst_suspend_status(p_analyst_id uuid, p_suspend boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status text;
  v_own_sponsor uuid;
begin
  select status, sponsor_id into v_current_status, v_own_sponsor from analysts where id = p_analyst_id for update;
  if not found then
    raise exception 'analyst % not found', p_analyst_id;
  end if;
  if p_suspend and v_current_status <> 'approved' then
    raise exception 'only an approved analyst can be suspended (current status: %)', v_current_status;
  end if;
  if not p_suspend and v_current_status <> 'suspended' then
    raise exception 'analyst is not suspended (current status: %)', v_current_status;
  end if;

  update analysts
  set status = case when p_suspend then 'suspended' else 'approved' end, updated_at = now()
  where id = p_analyst_id;

  if p_suspend then
    update analysts set sponsor_id = v_own_sponsor, updated_at = now() where sponsor_id = p_analyst_id;
  end if;
end;
$$;
