-- ============================================================================
-- Migration 016 — Institutional/B2B invoicing: invoice issuance, deposits,
-- final settlement, all auto-posted to the ledger.
--
-- Scope (confirmed with the user, 2026-07-13): this is a NEW, additive path
-- for back-office-created institutional/bulk orders — it does NOT touch the
-- existing consumer walk-in flow (Sales Order pay-now/voucher creation, the
-- sales_orders review table, or the manual postToLedger() batch for those
-- orders). Distinguished by the new orders.billing_mode column.
--
-- Architecture: mirrors the same "insert one canonical row, let a trigger do
-- everything else atomically" pattern as the commission engine and Task 2's
-- report-override trigger — NOT a client-invoked RPC write function, which
-- would be a new pattern this codebase doesn't otherwise use. The app layer
-- (Server Actions) does a single admin-client INSERT into `invoices` or
-- `payments`; a trigger on that table validates, posts the journal entries,
-- and updates invoice/order status, all inside the same transaction as the
-- INSERT — so there's no window where an invoice/payment row exists without
-- its accounting effect, or vice versa.
--
-- Two mutually-exclusive scenarios per order:
--   A. Invoice-first, pay-in-full-later: inserting a 'standard' invoice
--      books Dr AR / Cr Deferred Revenue. A later 'full_payment' payment
--      books Dr Cash / Cr AR, AND (confirmed fix — the original spec never
--      reclassified Deferred Revenue for this path, which would have left
--      that revenue permanently off the P&L) Dr Deferred Revenue / Cr Sales
--      Revenue, so revenue is recognized the moment cash arrives.
--   B. Deposit-first, settle-later: a 'deposit' payment books Dr Cash / Cr
--      Customer Deposits Received (no revenue yet). Inserting a
--      'final_settlement' invoice nets the deposit off the total and books
--      the compound entry Dr Customer Deposits Received (all prior
--      deposits) + Dr AR (remaining balance, if any) / Cr Sales Revenue
--      (full order total) — revenue is recognized at final-invoice time for
--      this path, matching the original spec. If the deposit fully covers
--      the total, there's no remaining AR line and the order settles
--      immediately. Otherwise a final 'final_payment' payment for the
--      remaining balance closes it out (Dr Cash / Cr AR only — revenue was
--      already recognized).
--
-- Final settlement (either scenario) flips orders.status = 'paid' to stay
-- consistent with the existing commission engine / Dashboard stats — the
-- same order_items-level commission trigger (calculate_commissions_for_order)
-- fires unchanged, zero changes to commission_engine.sql needed. Finance's
-- existing postToLedger() (the manual batch for immediate-mode orders) is
-- updated in application code to skip billing_mode = 'invoice' orders
-- entirely, since those are already auto-posted here — the guard against
-- double-posting revenue for the same order.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. orders: billing mode flag. Existing rows default to 'immediate'
--    (today's only mode), zero behavior change for them.
-- ----------------------------------------------------------------------------

alter table orders add column if not exists billing_mode text not null default 'immediate' check (billing_mode in ('immediate', 'invoice'));

-- ----------------------------------------------------------------------------
-- 2. invoices / payments: both tables are empty in production (confirmed
--    before writing this migration) — safe to add NOT NULL columns with no
--    backfill needed.
-- ----------------------------------------------------------------------------

alter table invoices add column if not exists amount numeric(12,2) not null default 0;
alter table invoices alter column amount drop default;
alter table invoices add column if not exists invoice_type text not null default 'standard' check (invoice_type in ('standard', 'final_settlement'));

alter table payments add column if not exists payment_type text not null default 'full_payment' check (payment_type in ('deposit', 'full_payment', 'final_payment'));
alter table payments alter column payment_type drop default;

-- ----------------------------------------------------------------------------
-- 3. New chart_of_accounts entries.
--    1100 AR and 2200 Deferred Revenue serve scenario A.
--    2300 Customer Deposits serve scenario B. Both scenarios credit the
--    EXISTING 4100 Detection Service Revenue on recognition — institutional
--    orders sell the same underlying service, just with different payment
--    terms, so the P&L revenue line stays unfragmented.
-- ----------------------------------------------------------------------------

insert into chart_of_accounts (code, name, account_type) values
  ('1100', '应收账款 (Accounts Receivable)', 'asset'),
  ('2200', '递延收入 (Deferred Revenue)', 'liability'),
  ('2300', '客户定金 (Customer Deposits Received)', 'liability')
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- 4. Trigger: invoice issuance.
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
-- 5. Trigger: payment recorded (deposit / full_payment / final_payment).
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
