-- A package's already-received deposit (migration 046) had no way to be
-- cleanly applied against a later batch order's invoice — recording it as a
-- SECOND payments.payment_type='deposit' row on that order would have made
-- handle_payment_recorded() book the cash side a second time (the cash was
-- already received once, at the original deposit collection). This adds a
-- dedicated RPC that nets the deposit against AR without touching cash, and
-- fixes handle_payment_recorded()'s full_payment check so "登记全款" only
-- demands whatever cash remains after any deposit was applied.
--
-- deposit_applied_amount / package_deposit_applied together let this be
-- called more than once over a package's lifetime (across several batch
-- orders) without ever applying more than the package actually has left.

alter table institutional_packages add column if not exists deposit_applied_amount numeric(12,2) not null default 0;
alter table orders add column if not exists package_deposit_applied numeric(12,2) not null default 0;

create or replace function apply_package_deposit_to_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_invoice invoices%rowtype;
  v_pkg institutional_packages%rowtype;
  v_remaining_deposit numeric;
  v_remaining_ar numeric;
  v_apply_amount numeric;
  v_entry_id uuid;
  v_deposits_account uuid;
  v_ar_account uuid;
  v_deferred_account uuid;
  v_revenue_account uuid;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;
  if v_order.institutional_package_id is null then
    raise exception 'this order is not linked to a package';
  end if;

  select * into v_invoice from invoices where order_id = p_order_id and invoice_type = 'standard' and status = 'issued';
  if not found then
    raise exception 'no active standard invoice found for this order';
  end if;

  select * into v_pkg from institutional_packages where id = v_order.institutional_package_id for update;
  if not found then
    raise exception 'package not found';
  end if;
  if v_pkg.deposit_received_at is null or v_pkg.deposit_amount is null then
    raise exception 'this package has no received deposit to apply';
  end if;

  v_remaining_deposit := v_pkg.deposit_amount - v_pkg.deposit_applied_amount;
  if v_remaining_deposit <= 0 then
    raise exception 'this package deposit has already been fully applied';
  end if;

  v_remaining_ar := v_order.total_amount - v_order.package_deposit_applied;
  if v_remaining_ar <= 0 then
    raise exception 'this order has no remaining balance to apply against';
  end if;

  v_apply_amount := least(v_remaining_deposit, v_remaining_ar);

  select id into v_deposits_account from chart_of_accounts where code = '2300';
  select id into v_ar_account from chart_of_accounts where code = '1100';

  insert into journal_entries (entry_date, source_type, source_id, description, posted_by)
  values (current_date, 'payment', v_invoice.id, '套餐定金抵扣 - ' || v_invoice.invoice_no, 'system')
  returning id into v_entry_id;
  insert into journal_lines (journal_entry_id, account_id, debit, credit) values
    (v_entry_id, v_deposits_account, v_apply_amount, 0),
    (v_entry_id, v_ar_account, 0, v_apply_amount);

  update institutional_packages set deposit_applied_amount = deposit_applied_amount + v_apply_amount where id = v_pkg.id;
  update orders set package_deposit_applied = package_deposit_applied + v_apply_amount where id = v_order.id;

  -- Fully settled by the deposit alone — recognize revenue and close out,
  -- the same way handle_payment_recorded()'s full_payment branch does for a
  -- cash payment, since no separate payments row will ever be recorded now.
  if v_remaining_ar - v_apply_amount <= 0 then
    select id into v_deferred_account from chart_of_accounts where code = '2200';
    select id into v_revenue_account from chart_of_accounts where code = '4100';

    insert into journal_entries (entry_date, source_type, source_id, description, posted_by)
    values (current_date, 'payment', v_invoice.id, '收入确认（定金抵扣结清） - ' || v_invoice.invoice_no, 'system')
    returning id into v_entry_id;
    insert into journal_lines (journal_entry_id, account_id, debit, credit) values
      (v_entry_id, v_deferred_account, v_invoice.amount, 0),
      (v_entry_id, v_revenue_account, 0, v_invoice.amount);

    update invoices set status = 'paid' where id = v_invoice.id;
    update orders set status = 'paid', updated_at = now() where id = v_order.id;
  end if;
end;
$$;

-- Patched: "登记全款" must now only require whatever cash remains after any
-- package-deposit application (package_deposit_applied), not the full
-- invoice amount — but revenue is still recognized for the FULL invoice
-- amount, since the deposit-funded portion already sits in Deposits
-- (2300) waiting to be recognized, same journal shape as before.
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
    if exists (select 1 from invoices where order_id = new.order_id and invoice_type = 'standard') then
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

    select coalesce(sum(amount), 0) into v_deposit_total from payments where order_id = new.order_id and payment_type = 'deposit';
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
