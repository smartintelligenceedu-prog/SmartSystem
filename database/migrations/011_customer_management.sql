-- ============================================================================
-- Migration 011 — Customer Management (Phase 4 upgrade)
--
-- Most of the requested customer fields already exist on `individuals`
-- (ic_or_passport_no, date_of_birth, gender, phone, email) — the earlier
-- Customers module just didn't collect them yet. Address reuses the
-- existing generic `addresses` table (keyed by party_id). Timeline reuses
-- the existing generic `audit_logs` table (entity_type = 'customer'). None
-- of those need schema changes.
--
-- What's genuinely new:
--   1. customers.occupation / customers.marital_status — not modeled
--      anywhere; scoped to `customers` rather than the shared `individuals`
--      table since occupation/marital status are customer-context business
--      fields, not universal person attributes analysts/introducers need.
--   2. customer_children — a customer can have multiple children; each
--      child is its own row (name/gender/dob/school/remark). Age is
--      deliberately NOT stored — it's derived from date_of_birth in the UI,
--      since a stored age would go stale the day after it's entered.
--   3. Introducer read access to customers they referred — the customers
--      table previously had no SELECT policy for introducers at all (only
--      owning analyst / back office). Confirmed with the user: Leader
--      visibility stays aggregate-only per the original Phase 3 decision
--      (no policy added for leaders here), only Introducer gets a new one.
-- ============================================================================

alter table customers add column if not exists occupation text;
alter table customers add column if not exists marital_status text;
alter table customers add constraint chk_customers_marital_status
  check (marital_status is null or marital_status in ('single', 'married', 'divorced', 'widowed', 'other'));

create table customer_children (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  full_name text not null,
  gender text check (gender in ('male', 'female', 'other', 'undisclosed')),
  date_of_birth date,
  school text,
  remark text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_customer_children_customer on customer_children(customer_id);

alter table customer_children enable row level security;

create policy "analyst reads own customers' children, back office reads all"
  on customer_children for select
  using (
    is_back_office()
    or exists (select 1 from customers c where c.id = customer_children.customer_id and c.owner_analyst_id = current_analyst_id())
    or exists (select 1 from customers c where c.id = customer_children.customer_id and c.acquired_via_introducer_id = current_introducer_id())
  );

create policy "back office writes customer children" on customer_children for insert with check (is_back_office());
create policy "back office updates customer children" on customer_children for update using (is_back_office());

create policy "introducer reads own referred customers" on customers for select
  using (acquired_via_introducer_id = current_introducer_id());

create trigger set_updated_at before update on customer_children for each row execute function set_updated_at();
