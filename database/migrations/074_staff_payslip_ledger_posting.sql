-- Wires staff_payslips into the real P&L for the first time. Until now these
-- were pure standalone records — a 'payslip' (company pays the employee) or
-- 'admin_fee' (a Leader/Consultant owes the company for pooled admin/office
-- overhead, migration 072) never touched journal_entries/journal_lines, so
-- getProfitAndLoss() and the Dashboard's Net Profit both silently ignored
-- them (confirmed: no trigger, no posting button, nothing referenced this
-- table anywhere in finance_engine.sql or finance/actions.ts).
--
-- New accounts:
--   6300 Staff Salary (expense) — debited when a 'payslip' is created. A
--     payslip already represents a completed payment (see the "back office
--     types it each time a plain staff member gets paid" comment on
--     createStaffPayslip), so it posts immediately at creation, same as
--     recordOperatingExpense().
--   4900 Admin Fee Recovery (revenue) — credited when an 'admin_fee' is
--     marked paid (markStaffPayslipPaid). Kept separate from 4000/4100 real
--     customer revenue so the P&L breakdown doesn't blend the two.
--
-- void_staff_payslip_entry mirrors void_manual_expense (migrations 053/054)
-- exactly: posts a swapped-debit/credit reversal entry (source_type
-- 'staff_payslip_void', source_id = the entry being reversed) and marks the
-- original 'voided', rather than ever mutating a posted entry's amounts —
-- same audit-trail discipline as every other ledger correction in this app.
-- Called by deleteStaffPayslip() before removing a posted row, and by
-- updateStaffPayslip() indirectly in that it now REFUSES to change
-- gross_amount/period once a non-voided entry exists for the row (only the
-- description stays freely editable, matching updateExpenseDescription's
-- own restriction).

insert into chart_of_accounts (code, name, account_type) values
  ('6300', 'Staff Salary', 'expense'),
  ('4900', 'Admin Fee Recovery', 'revenue')
on conflict (code) do nothing;

create or replace function void_staff_payslip_entry(p_journal_entry_id uuid, p_posted_by text default 'system')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry journal_entries%rowtype;
  v_line record;
  v_new_entry_id uuid;
begin
  select * into v_entry from journal_entries where id = p_journal_entry_id for update;
  if not found then
    raise exception 'journal entry % not found', p_journal_entry_id;
  end if;
  if v_entry.source_type <> 'staff_payslip' then
    raise exception 'only staff_payslip entries can be voided this way';
  end if;
  if v_entry.status = 'voided' then
    raise exception 'this entry has already been voided';
  end if;

  insert into journal_entries (entry_date, source_type, source_id, description, posted_by)
  values (current_date, 'staff_payslip_void', p_journal_entry_id, '作废 - ' || coalesce(v_entry.description, p_journal_entry_id::text), p_posted_by)
  returning id into v_new_entry_id;

  for v_line in select account_id, debit, credit from journal_lines where journal_entry_id = p_journal_entry_id loop
    insert into journal_lines (journal_entry_id, account_id, debit, credit)
    values (v_new_entry_id, v_line.account_id, v_line.credit, v_line.debit);
  end loop;

  update journal_entries set status = 'voided' where id = p_journal_entry_id;
end;
$$;
