-- Back office had no way to fix a wrongly-created institutional order once
-- an invoice was issued for it (wrong item name/price/student names/analyst,
-- but no payment recorded yet). Adds a voidInvoice() action (application
-- layer) that marks the mistaken invoice status = 'void' — a value the
-- invoices.status check constraint already allowed, just never used.
--
-- handle_invoice_issued()'s "this order already has an invoice" guard
-- previously counted ANY invoice row regardless of status, which would have
-- permanently blocked re-issuing a corrected invoice after voiding the wrong
-- one. This patches that one guard to ignore voided invoices, leaving every
-- other check (billing_mode, order.status, deposit/settlement rules)
-- unchanged. Pure function replace — no data migration needed since no
-- invoice has ever been voided yet.

create or replace function handle_invoice_issued()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_ar_account uuid;
  v_deferred_account uuid;
  v_deposits_account uuid;
  v_revenue_account uuid;
  v_entry_id uuid;
  v_deposit_total numeric;
  v_remaining numeric;
begin
  select * into v_order from orders where id = new.order_id for update;
  if not found then
    raise exception 'order % not found', new.order_id;
  end if;
  if v_order.billing_mode <> 'invoice' then
    raise exception 'order is not in invoice billing mode';
  end if;
  if v_order.status <> 'pending' then
    raise exception 'order is not in a state that can be invoiced';
  end if;
  if exists (select 1 from invoices where order_id = new.order_id and id <> new.id and status <> 'void') then
    raise exception 'this order already has an invoice';
  end if;

  select id into v_ar_account from chart_of_accounts where code = '1100';
  select id into v_deferred_account from chart_of_accounts where code = '2200';
  select id into v_deposits_account from chart_of_accounts where code = '2300';
  select id into v_revenue_account from chart_of_accounts where code = '4100';

  if new.invoice_type = 'standard' then
    if exists (select 1 from payments where order_id = new.order_id and payment_type = 'deposit') then
      raise exception 'this order already has a deposit — use a final settlement invoice instead';
    end if;

    insert into journal_entries (entry_date, source_type, source_id, description, posted_by)
    values (current_date, 'invoice', new.id, '开票 - ' || new.invoice_no, 'system')
    returning id into v_entry_id;

    insert into journal_lines (journal_entry_id, account_id, debit, credit) values
      (v_entry_id, v_ar_account, new.amount, 0),
      (v_entry_id, v_deferred_account, 0, new.amount);

  elsif new.invoice_type = 'final_settlement' then
    select coalesce(sum(amount), 0) into v_deposit_total from payments where order_id = new.order_id and payment_type = 'deposit';
    if v_deposit_total <= 0 then
      raise exception 'this order has no deposit — use a standard invoice instead';
    end if;
    if v_deposit_total > new.amount then
      raise exception 'deposit total (%) exceeds order total (%)', v_deposit_total, new.amount;
    end if;

    v_remaining := new.amount - v_deposit_total;

    insert into journal_entries (entry_date, source_type, source_id, description, posted_by)
    values (current_date, 'invoice', new.id, '结算发票 - ' || new.invoice_no, 'system')
    returning id into v_entry_id;

    if v_remaining > 0 then
      insert into journal_lines (journal_entry_id, account_id, debit, credit) values
        (v_entry_id, v_deposits_account, v_deposit_total, 0),
        (v_entry_id, v_ar_account, v_remaining, 0),
        (v_entry_id, v_revenue_account, 0, new.amount);
    else
      insert into journal_lines (journal_entry_id, account_id, debit, credit) values
        (v_entry_id, v_deposits_account, v_deposit_total, 0),
        (v_entry_id, v_revenue_account, 0, new.amount);
      update invoices set status = 'paid' where id = new.id;
      update orders set status = 'paid', updated_at = now() where id = new.order_id;
    end if;
  else
    raise exception 'unknown invoice_type %', new.invoice_type;
  end if;

  return new;
end;
$$;
