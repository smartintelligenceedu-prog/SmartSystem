-- Short introducer referral codes, matching migration 034's analyst
-- treatment: introducers.referral_code was a 32-char random hex string
-- (from randomUUID().replace(/-/g, "")) — unreadable, unshareable out loud.
-- Switched to a sequential "IN-0001" style code. Safe to regenerate for
-- existing rows because nothing references referral_code by foreign key —
-- it's only ever looked up by text (public /refer/[code] link,
-- /register-introducer?ref=<analyst_code>).
--
-- Self-contained + idempotent: every statement guarded, safe to rerun.

create sequence if not exists introducer_referral_code_seq;

-- Only touches rows that don't already look like "IN-0001" — reruns are a
-- no-op once every row has been converted, so this never burns extra
-- sequence numbers on a second apply.
do $$
declare
  r record;
begin
  for r in select id from introducers where referral_code !~ '^IN-[0-9]{4,}$' order by created_at loop
    update introducers set referral_code = 'IN-' || lpad(nextval('introducer_referral_code_seq')::text, 4, '0') where id = r.id;
  end loop;
end $$;

alter table introducers alter column referral_code set default ('IN-' || lpad(nextval('introducer_referral_code_seq')::text, 4, '0'));
