-- Lets a payout run cover more than one calendar month (e.g. a late catch-up
-- run for straggler commissions that only got approved after the tidy
-- month-end run already happened) WITHOUT the resulting payslip/statement
-- showing agents a confusing multi-month range like "1 August - 30
-- September". Previously analyst_payslips/introducer_commission_statements
-- had no period of their own — they always displayed whatever period_start/
-- period_end the parent commission_payout_runs row happened to be run with,
-- even when that row's underlying commission_records actually spanned two
-- different months. Going forward (see runMonthlyPayout() in
-- payroll/actions.ts) one run produces one payslip/statement row PER
-- calendar month actually present in that payee's swept commission_records,
-- each carrying its own accurate period_start/period_end.

alter table analyst_payslips add column if not exists period_start date;
alter table analyst_payslips add column if not exists period_end date;
alter table introducer_commission_statements add column if not exists period_start date;
alter table introducer_commission_statements add column if not exists period_end date;

-- Backfill existing rows from their parent run so historical payslips keep
-- showing the same period they always have.
update analyst_payslips ap
  set period_start = r.period_start, period_end = r.period_end
  from commission_payout_runs r
  where r.id = ap.payout_run_id and ap.period_start is null;

update introducer_commission_statements ics
  set period_start = r.period_start, period_end = r.period_end
  from commission_payout_runs r
  where r.id = ics.payout_run_id and ics.period_start is null;

-- The old (payout_run_id, analyst_id) uniqueness assumed one payslip per
-- payee per run — no longer true once a single run can produce one row per
-- covered month for the same payee.
alter table analyst_payslips drop constraint if exists analyst_payslips_payout_run_id_analyst_id_key;
alter table analyst_payslips add constraint analyst_payslips_run_analyst_period_key
  unique (payout_run_id, analyst_id, period_start, period_end);

alter table introducer_commission_statements drop constraint if exists introducer_commission_statements_payout_run_id_introducer_id_key;
alter table introducer_commission_statements add constraint introducer_commission_statements_run_introducer_period_key
  unique (payout_run_id, introducer_id, period_start, period_end);
