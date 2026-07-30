-- There was no way to undo a wrongly-recorded deposit payment (e.g. a
-- back-office double-click recording the same deposit three times) — once
-- inserted, handle_payment_recorded() had already posted the cash/deposits
-- journal entry and there was no status column to mark it invalid. This
-- adds a status column plus an RPC that posts the exact reverse entry
-- (debit Deposits / credit Cash) so a mistaken deposit payment can be
-- cleanly undone without deleting the audit trail.
--
-- Deliberately scoped to payment_type = 'deposit' only — full_payment/
-- final_payment also flip the invoice/order to 'paid' and recognize
-- revenue, so undoing those cleanly needs more than a single reversing
-- entry; out of scope until an actual need for that arises.

alter table payments add column if not exists status text not null default 'recorded' check (status in ('recorded', 'voided'));

create or replace function void_deposit_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments%rowtype;
  v_receipt receipts%rowtype;
  v_cash_account uuid;
  v_deposits_account uuid;
  v_entry_id uuid;
begin
  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment % not found', p_payment_id;
  end if;
  if v_payment.payment_type <> 'deposit' then
    raise exception 'only deposit payments can be voided this way';
  end if;
  if v_payment.status = 'voided' then
    raise exception 'this payment has already been voided';
  end if;

  select * into v_receipt from receipts where payment_id = p_payment_id;

  select id into v_cash_account from chart_of_accounts where code = '1000';
  select id into v_deposits_account from chart_of_accounts where code = '2300';

  insert into journal_entries (entry_date, source_type, source_id, description, posted_by)
  values (current_date, 'payment', p_payment_id, '作废定金 - ' || coalesce(v_receipt.receipt_no, p_payment_id::text), 'system')
  returning id into v_entry_id;
  insert into journal_lines (journal_entry_id, account_id, debit, credit) values
    (v_entry_id, v_deposits_account, v_payment.amount, 0),
    (v_entry_id, v_cash_account, 0, v_payment.amount);

  update payments set status = 'voided' where id = p_payment_id;
end;
$$;
