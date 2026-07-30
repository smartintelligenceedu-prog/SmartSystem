-- Manual operating-expense entries (recordOperatingExpense, source_type =
-- 'manual_expense') post straight to the ledger with no review queue and no
-- way to undo a wrong entry (wrong amount, wrong category, fat-fingered
-- description) — see void_deposit_payment (migration 050) for the same
-- problem solved for deposit payments. This adds the same status column to
-- journal_entries plus an RPC that posts the exact reverse entry, scoped
-- strictly to source_type = 'manual_expense' (every other source_type keeps
-- its existing "no void" behavior — out of scope until a real need arises).

alter table journal_entries add column if not exists status text not null default 'posted' check (status in ('posted', 'voided'));

create or replace function void_manual_expense(p_journal_entry_id uuid, p_posted_by text default 'system')
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
  if v_entry.source_type <> 'manual_expense' then
    raise exception 'only manual expense entries can be voided this way';
  end if;
  if v_entry.status = 'voided' then
    raise exception 'this entry has already been voided';
  end if;

  insert into journal_entries (entry_date, source_type, source_id, description, posted_by)
  values (current_date, 'manual_expense', null, '作废开销 - ' || coalesce(v_entry.description, p_journal_entry_id::text), p_posted_by)
  returning id into v_new_entry_id;

  for v_line in select account_id, debit, credit from journal_lines where journal_entry_id = p_journal_entry_id loop
    insert into journal_lines (journal_entry_id, account_id, debit, credit)
    values (v_new_entry_id, v_line.account_id, v_line.credit, v_line.debit);
  end loop;

  update journal_entries set status = 'voided' where id = p_journal_entry_id;
end;
$$;
