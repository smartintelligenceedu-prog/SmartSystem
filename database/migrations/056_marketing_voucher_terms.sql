-- Adds a Terms & Conditions field to voucher cards, requested after
-- migration 055 shipped. Nullable — existing rows have no terms yet and
-- that's fine, it just means nothing is shown for them.
alter table marketing_vouchers add column if not exists terms text;
