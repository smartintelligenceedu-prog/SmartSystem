-- ============================================================================
-- Migration 070 — Let back office manually reassign an introducer's sponsor
--
-- Introducers already get a sponsor at creation time (CreateIntroducerForm)
-- or via /register-introducer's manual code / auto-detected match (migration
-- 069's predecessor logic), but there was no way to change it afterwards —
-- e.g. an introducer applied before their referrer's link was known, or was
-- attributed to the wrong person. Mirrors admin_reassign_analyst_sponsor()
-- exactly (same self-reference and cycle guards), just on introducers.
-- ============================================================================

create or replace function admin_reassign_introducer_sponsor(p_introducer_id uuid, p_new_sponsor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_walk uuid;
begin
  if p_new_sponsor_id is not null then
    if p_new_sponsor_id = p_introducer_id then
      raise exception 'an introducer cannot be their own sponsor';
    end if;
    if not exists (select 1 from introducers where id = p_new_sponsor_id) then
      raise exception 'new sponsor % not found', p_new_sponsor_id;
    end if;
    v_walk := p_new_sponsor_id;
    while v_walk is not null loop
      if v_walk = p_introducer_id then
        raise exception 'cannot reassign: % is a descendant of %, this would create a cycle', p_new_sponsor_id, p_introducer_id;
      end if;
      select sponsor_id into v_walk from introducers where id = v_walk;
    end loop;
  end if;

  update introducers set sponsor_id = p_new_sponsor_id, updated_at = now() where id = p_introducer_id;
end;
$$;
