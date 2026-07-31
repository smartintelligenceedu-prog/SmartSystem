-- Adds an optional single spouse record to customers (name/phone/DOB only,
-- per explicit user decision — not a repeatable list like customer_children,
-- since a customer only ever has at most one spouse on file).
alter table customers add column if not exists spouse_full_name text;
alter table customers add column if not exists spouse_phone text;
alter table customers add column if not exists spouse_date_of_birth date;
