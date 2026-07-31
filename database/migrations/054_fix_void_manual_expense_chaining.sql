-- Bug: void_manual_expense's reversal entry was inserted with
-- source_type = 'manual_expense' (same as a genuinely user-recorded
-- expense), so the Finance page's "show a Void button for manual_expense
-- rows" check couldn't tell a reversal apart from a real expense — the
-- reversal itself showed a Void button, and voiding THAT created another
-- reversal-of-a-reversal, on and on, with the description growing a new
-- "作废开销 - " prefix every time. Fixes it two ways: the reversal now gets
-- its own source_type ('manual_expense_void', which the UI's source_type
-- === 'manual_expense' check naturally excludes — no app-code change
-- needed) and source_id pointing back at the entry it reverses, plus an
-- explicit guard rejecting any attempt to void a reversal directly (belt
-- and suspenders, in case something ever calls the RPC outside the UI).

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
  if v_entry.source_id is not null then
    raise exception 'a reversal entry cannot itself be voided';
  end if;
  if v_entry.status = 'voided' then
    raise exception 'this entry has already been voided';
  end if;

  insert into journal_entries (entry_date, source_type, source_id, description, posted_by)
  values (current_date, 'manual_expense_void', p_journal_entry_id, '作废开销 - ' || coalesce(v_entry.description, p_journal_entry_id::text), p_posted_by)
  returning id into v_new_entry_id;

  for v_line in select account_id, debit, credit from journal_lines where journal_entry_id = p_journal_entry_id loop
    insert into journal_lines (journal_entry_id, account_id, debit, credit)
    values (v_new_entry_id, v_line.account_id, v_line.credit, v_line.debit);
  end loop;

  update journal_entries set status = 'voided' where id = p_journal_entry_id;
end;
$$;
