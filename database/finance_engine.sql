-- ============================================================================
-- TQC Business Management System — Institutional Invoicing Engine (v1.0)
-- Apply after schema.sql + rls_policies.sql + commission_engine.sql.
--
-- Institutional/B2B orders (orders.billing_mode = 'invoice', migration 016)
-- go through invoices/payments instead of the consumer walk-in
-- pay-now/voucher flow. Same design philosophy as commission_engine.sql:
-- the accounting effect runs as a Postgres trigger fired by a single INSERT,
-- so it commits atomically with the row that caused it — an invoice or
-- payment can never exist without its journal entries, or vice versa.
--
-- Two mutually-exclusive scenarios per order:
--   A. Invoice-first, pay-in-full-later: inserting a 'standard' invoice
--      books Dr AR (1100) / Cr Deferred Revenue (2200). A later
--      'full_payment' books Dr Cash (1000) / Cr AR, AND reclassifies
--      Dr Deferred Revenue / Cr Sales Revenue (4100) — revenue is
--      recognized the moment cash arrives.
--   B. Deposit-first, settle-later: a 'deposit' payment books Dr Cash /
--      Cr Customer Deposits Received (2300), no revenue yet. Inserting a
--      'final_settlement' invoice nets the deposit off the order total and
--      books the compound entry Dr Deposits Received (all prior deposits)
--      + Dr AR (remaining balance, if any) / Cr Sales Revenue (full order
--      total) — revenue is recognized at final-invoice time for this path.
--      If the deposit fully covers the total, the order settles
--      immediately; otherwise a final 'final_payment' for the remaining
--      balance closes it out (Dr Cash / Cr AR only — revenue already
--      recognized).
--
-- Final settlement (either scenario) flips orders.status = 'paid', which
-- fires the existing calculate_commissions_for_order() trigger unchanged —
-- no changes to commission_engine.sql. finance/actions.ts's postToLedger()
-- (manual batch for immediate-mode orders) explicitly skips
-- billing_mode = 'invoice' orders to avoid double-posting revenue.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Trigger: invoice issuance.
-- ----------------------------------------------------------------------------

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
  if exists (select 1 from invoices where order_id = new.order_id and id <> new.id) then
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

drop trigger if exists trg_invoice_issued on invoices;
create trigger trg_invoice_issued
  after insert on invoices
  for each row
  execute function handle_invoice_issued();

-- ----------------------------------------------------------------------------
-- Trigger: payment recorded (deposit / full_payment / final_payment).
-- ----------------------------------------------------------------------------

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
    if new.amount <> v_invoice.amount then
      raise exception 'payment amount must equal the invoice amount (%)', v_invoice.amount;
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
      (v_entry_id, v_deferred_account, new.amount, 0),
      (v_entry_id, v_revenue_account, 0, new.amount);

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

drop trigger if exists trg_payment_recorded on payments;
create trigger trg_payment_recorded
  after insert on payments
  for each row
  execute function handle_payment_recorded();

-- ----------------------------------------------------------------------------
-- Institutional voucher generation (Phase 2 Task 1, migration 018).
--
-- Fires on the same orders.status -> 'paid' transition as
-- calculate_commissions_for_order() (commission_engine.sql) — Postgres runs
-- multiple triggers on one table/event independently, so this coexists
-- without touching that function. Covers both ways an institutional order
-- reaches 'paid': handle_payment_recorded()'s full_payment/final_payment
-- branches above, and handle_invoice_issued()'s deposit-fully-covers-total
-- branch — both just UPDATE orders.status, which this trigger reacts to
-- generically. Idempotent: skips generation if the order already has any
-- vouchers, so firing more than once never double-issues credits.
-- ----------------------------------------------------------------------------

create or replace function generate_institutional_vouchers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item order_items%rowtype;
  v_qty int;
  i int;
  v_code text;
  v_attempts int;
begin
  if new.billing_mode <> 'invoice' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'paid' then
      return new;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.status <> 'paid' or old.status = 'paid' then
      return new;
    end if;
  end if;

  if exists (select 1 from institutional_vouchers where order_id = new.id) then
    return new;
  end if;

  for v_item in select * from order_items where order_id = new.id loop
    v_qty := greatest(coalesce(v_item.quantity, 1), 1);
    for i in 1..v_qty loop
      v_attempts := 0;
      loop
        v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
        begin
          insert into institutional_vouchers (order_id, voucher_code) values (new.id, v_code);
          exit;
        exception when unique_violation then
          v_attempts := v_attempts + 1;
          if v_attempts > 5 then
            raise exception 'failed to generate a unique voucher code after 5 attempts';
          end if;
        end;
      end loop;
    end loop;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_generate_institutional_vouchers on orders;
create trigger trg_generate_institutional_vouchers
  after insert or update of status on orders
  for each row
  execute function generate_institutional_vouchers();
