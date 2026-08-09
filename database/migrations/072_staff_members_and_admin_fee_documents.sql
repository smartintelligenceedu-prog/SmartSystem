-- Three fixes for the Staff Payslip feature (/admin/payroll):
--
-- 1. staff_members: a lightweight payee roster that only needs a name — the
--    "Employee" dropdown on the create-staff-payslip form previously only
--    listed people with a users/auth login (listStaffPayslipRecipients()
--    read from `users`), forcing back office to create a full login account
--    just to pay a pure back-office employee who will never sign in. This
--    table lets back office register a bare party/individual identity for
--    payroll purposes only, with no login attached.
--
-- 2. staff_payslips.document_type: distinguishes a real payslip (company
--    pays the person) from an admin_fee statement (the reverse — a Leader
--    is being billed for their share of pooled admin/office overhead).
--    Same row shape either way; only the printed title/wording differs.
--
-- 3. staff_payslips was missing update/delete RLS (only select/insert
--    existed since migration 032) — back office had no way to correct or
--    remove a mistaken entry.

create table if not exists staff_members (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null unique references parties(id),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

alter table staff_payslips add column if not exists document_type text not null default 'payslip';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_payslips_document_type_check') then
    alter table staff_payslips
      add constraint staff_payslips_document_type_check check (document_type in ('payslip', 'admin_fee'));
  end if;
end $$;

alter table staff_members enable row level security;

drop policy if exists "back office reads staff members" on staff_members;
create policy "back office reads staff members" on staff_members for select
  using (is_back_office());

drop policy if exists "back office writes staff members" on staff_members;
create policy "back office writes staff members" on staff_members for insert
  with check (is_back_office());

drop policy if exists "back office updates staff members" on staff_members;
create policy "back office updates staff members" on staff_members for update
  using (is_back_office());

drop policy if exists "back office updates staff payslips" on staff_payslips;
create policy "back office updates staff payslips" on staff_payslips for update
  using (is_back_office());

drop policy if exists "back office deletes staff payslips" on staff_payslips;
create policy "back office deletes staff payslips" on staff_payslips for delete
  using (is_back_office());
