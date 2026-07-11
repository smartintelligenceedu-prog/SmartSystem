-- ============================================================================
-- TQC Business Management System — Bootstrap the first admin (run once)
--
-- Chicken-and-egg problem: every write through the app goes through RLS,
-- and every write policy checks is_back_office(), which checks user_roles —
-- which is empty on a brand new project. Someone has to exist first. This
-- script does that one time, run by hand in the SQL Editor (you're already
-- authenticated as the Postgres owner there, so RLS doesn't apply to you).
--
-- Steps:
--   1. Supabase Dashboard -> Authentication -> Users -> Add user
--      (email + password is fine for now; a real sign-in page comes later)
--   2. Copy that user's UUID (shown in the users list) into v_auth_id below
--   3. Fill in your own name/email on the insert into individuals line
--   4. Run this whole file once in the SQL Editor
-- ============================================================================

do $$
declare
  v_auth_id uuid := '9649d214-1b65-40af-a78e-5af3cf483902';
  v_party_id uuid;
  v_user_id uuid;
  v_role_id uuid;
begin
  if v_auth_id = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Edit v_auth_id in this script before running it — see the comment block above.';
  end if;

  insert into parties (party_type) values ('individual') returning id into v_party_id;

  insert into individuals (party_id, full_name, email)
  values (v_party_id, 'Chan Wei Yit', 'weiyitchan6411@gmail.com');

  insert into users (party_id, auth_user_id) values (v_party_id, v_auth_id) returning id into v_user_id;

  select id into v_role_id from roles where name = 'admin';
  insert into user_roles (user_id, role_id) values (v_user_id, v_role_id);

  raise notice 'Admin bootstrapped: party_id=%, user_id=%', v_party_id, v_user_id;
end;
$$;
