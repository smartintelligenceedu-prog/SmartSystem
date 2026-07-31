-- Voucher Portal redemption tracking: an introducer can redeem a given
-- voucher once (unique(voucher_id, introducer_id) enforces this at the DB
-- level, not just in the UI). Redeeming is purely a marker for now — no
-- automatic discount/commission trigger, per what was actually asked for.
-- Rows are append-only (no update/delete policy) like this app's other
-- audit-style tables.

create table if not exists marketing_voucher_redemptions (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references marketing_vouchers(id),
  introducer_id uuid not null references introducers(id),
  redeemed_at timestamptz not null default now(),
  unique (voucher_id, introducer_id)
);

create index if not exists idx_marketing_voucher_redemptions_introducer on marketing_voucher_redemptions (introducer_id);

alter table marketing_voucher_redemptions enable row level security;

drop policy if exists "introducer reads own voucher redemptions" on marketing_voucher_redemptions;
create policy "introducer reads own voucher redemptions" on marketing_voucher_redemptions for select
  using (introducer_id = current_introducer_id() or is_back_office());

drop policy if exists "introducer inserts own voucher redemption" on marketing_voucher_redemptions;
create policy "introducer inserts own voucher redemption" on marketing_voucher_redemptions for insert
  with check (introducer_id = current_introducer_id());
