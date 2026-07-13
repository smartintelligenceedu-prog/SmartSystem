-- ============================================================================
-- Migration 018 — Institutional voucher generation + redemption.
--
-- Phase 2 Task 1: a paid/settled institutional order (orders.billing_mode =
-- 'invoice') converts into `order_items.quantity` redeemable detection
-- vouchers, one per credit purchased. Self-contained (schema + trigger in
-- one file, per the migration-015 lesson learned earlier this project).
--
-- Generation trigger fires on the SAME orders.status -> 'paid' transition
-- that already drives calculate_commissions_for_order() (commission_engine.sql)
-- — Postgres allows multiple independent triggers on one table/event, so
-- this coexists without touching that function. It covers both ways an
-- institutional order reaches 'paid': handle_payment_recorded()'s
-- full_payment/final_payment branches, and handle_invoice_issued()'s
-- deposit-fully-covers-total branch (finance_engine.sql) — both just UPDATE
-- orders.status, which this trigger reacts to generically, so no changes
-- needed there either.
--
-- Idempotent generation: guarded by "skip if this order already has any
-- vouchers", so a trigger firing more than once (e.g. a future code path
-- that re-touches status) never double-issues credits.
-- ============================================================================

create table if not exists institutional_vouchers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  voucher_code text not null unique,
  status text not null default 'unused' check (status in ('unused', 'used', 'cancelled')),
  used_by_child_id uuid references customer_children(id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_institutional_vouchers_order on institutional_vouchers(order_id);
create index if not exists idx_institutional_vouchers_status on institutional_vouchers(status);

-- Back office manages/views the raw table (same posture as invoices/
-- payments). Redemption itself goes through a Server Action using the
-- admin client + its own app-layer permission check (front-line analysts,
-- not just back office, need to redeem — same pattern as every other
-- mutation in this codebase, RLS is not the primary gate for legitimate
-- app-driven writes).
alter table institutional_vouchers enable row level security;
drop policy if exists "back office only" on institutional_vouchers;
create policy "back office only" on institutional_vouchers for all using (is_back_office()) with check (is_back_office());

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
    return new; -- already generated (idempotency guard)
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
