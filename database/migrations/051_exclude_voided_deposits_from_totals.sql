-- Migration 050 added payments.status so a wrongly-recorded deposit could be
-- voided, but missed three other places that sum/check payment_type='deposit'
-- rows without excluding voided ones — so a voided duplicate deposit still
-- silently counted toward "does this order have a deposit" and "how much
-- deposit has been received", breaking issue-final-settlement-invoice and
-- record-final-payment with a stale total. This patches all three, plus one
-- more pre-existing gap in the same spirit as migration 047 (a voided
-- STANDARD invoice should not block recording a deposit either).

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
    -- Migration 051 — a voided deposit no longer forces "use a final
    -- settlement invoice instead".
    if exists (select 1 from payments where order_id = new.order_id and payment_type = 'deposit' and status <> 'voided') then
      raise exception 'this order already has a deposit — use a final settlement invoice instead';
    end if;

    insert into journal_entries (entry_date, source_type, source_id, description, posted_by)
    values (current_date, 'invoice', new.id, '开票 - ' || new.invoice_no, 'system')
    returning id into v_entry_id;

    insert into journal_lines (journal_entry_id, account_id, debit, credit) values
      (v_entry_id, v_ar_account, new.amount, 0),
      (v_entry_id, v_deferred_account, 0, new.amount);

  elsif new.invoice_type = 'final_settlement' then
    -- Migration 051 — voided deposits no longer count toward this total.
    select coalesce(sum(amount), 0) into v_deposit_total from payments where order_id = new.order_id and payment_type = 'deposit' and status <> 'voided';
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

create or replace function handle_payment_recorded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_invoice invoices%rowtype;
  v_receipt_no text;
  v_cash_account uuid;
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
  if v_order.status in ('paid', 'cancelled', 'refunded') then
    raise exception 'order is already settled or closed';
  end if;

  v_receipt_no := 'RCP-' || to_char(now(), 'YYYYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  insert into receipts (payment_id, receipt_no, issued_at) values (new.id, v_receipt_no, now());

  select id into v_cash_account from chart_of_accounts where code = '1000';
  select id into v_ar_account from chart_of_accounts where code = '1100';
  select id into v_deferred_account from chart_of_accounts where code = '2200';
  select id into v_deposits_account from chart_of_accounts where code = '2300';
  select id into v_revenue_account from chart_of_accounts where code = '4100';

  if new.payment_type = 'deposit' then
    -- Migration 051 — a voided standard invoice no longer blocks recording
    -- a deposit, same spirit as migration 047's equivalent fix.
    if exists (select 1 from invoices where order_id = new.order_id and invoice_type = 'standard' and status <> 'void') then
      raise exception 'this order already has a standard invoice — deposits are not applicable';
    end if;

    insert into journal_entries (entry_date, source_type, source_id, description, posted_by)
    values (current_date, 'payment', new.id, '客户定金 - ' || v_receipt_no, 'system')
    returning id into v_entry_id;
    insert into journal_lines (journal_entry_id, account_id, debit, credit) values
      (v_entry_id, v_cash_account, new.amount, 0),
      (v_entry_id, v_deposits_account, 0, new.amount);

  elsif new.payment_type = 'full_payment' then
    select * into v_invoice from invoices where order_id = new.order_id and invoice_type = 'standard' and status = 'issued';
    if not found then
      raise exception 'no outstanding standard invoice found for this order';
    end if;
    if new.amount <> (v_invoice.amount - v_order.package_deposit_applied) then
      raise exception 'payment amount must equal the remaining balance after any package deposit applied (%)', v_invoice.amount - v_order.package_deposit_applied;
    end if;

    insert into journal_entries (entry_date, source_type, source_id, description, posted_by)
    values (current_date, 'payment', new.id, '收款 - ' || v_receipt_no, 'system')
    returning id into v_entry_id;
    insert into journal_lines (journal_entry_id, account_id, debit, credit) values
      (v_entry_id, v_cash_account, new.amount, 0),
      (v_entry_id, v_ar_account, 0, new.amount);

    insert into journal_entries (entry_date, source_type, source_id, description, posted_by)
    values (current_date, 'payment', new.id, '收入确认 - ' || v_invoice.invoice_no, 'system')
    returning id into v_entry_id;
    insert into journal_lines (journal_entry_id, account_id, debit, credit) values
      (v_entry_id, v_deferred_account, v_invoice.amount, 0),
      (v_entry_id, v_revenue_account, 0, v_invoice.amount);

    update invoices set status = 'paid' where id = v_invoice.id;
    update orders set status = 'paid', updated_at = now() where id = new.order_id;

  elsif new.payment_type = 'final_payment' then
    select * into v_invoice from invoices where order_id = new.order_id and invoice_type = 'final_settlement' and status = 'issued';
    if not found then
      raise exception 'no outstanding final settlement invoice found for this order';
    end if;

    -- Migration 051 — voided deposits no longer count toward this total.
    select coalesce(sum(amount), 0) into v_deposit_total from payments where order_id = new.order_id and payment_type = 'deposit' and status <> 'voided';
    v_remaining := v_invoice.amount - v_deposit_total;
    if new.amount <> v_remaining then
      raise exception 'payment amount must equal the remaining balance (%)', v_remaining;
    end if;

    insert into journal_entries (entry_date, source_type, source_id, description, posted_by)
    values (current_date, 'payment', new.id, '尾款 - ' || v_receipt_no, 'system')
    returning id into v_entry_id;
    insert into journal_lines (journal_entry_id, account_id, debit, credit) values
      (v_entry_id, v_cash_account, new.amount, 0),
      (v_entry_id, v_ar_account, 0, new.amount);

    update invoices set status = 'paid' where id = v_invoice.id;
    update orders set status = 'paid', updated_at = now() where id = new.order_id;

  else
    raise exception 'unknown payment_type %', new.payment_type;
  end if;

  return new;
end;
$$;
