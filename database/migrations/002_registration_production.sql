-- ============================================================================
-- Migration 002 — Registration module, production fields + approval workflow
-- Run this on the live project (schema.sql/rls_policies.sql/commission_engine.sql
-- /seed.sql/bootstrap_admin.sql are already applied there — this is additive).
-- Apply in the SQL Editor as one paste, in order top to bottom.
-- ============================================================================

-- ---- identity: nickname ----
alter table individuals add column if not exists nickname text;

-- ---- analysts: payout bank details, assigned leader, real status workflow ----
alter table analysts add column if not exists bank_name text;
alter table analysts add column if not exists bank_account_name text;
alter table analysts add column if not exists bank_account_no text;

-- Independent from sponsor_id (the Introducer / commission relationship):
-- this is a purely operational "which team does this analyst report to"
-- assignment that back office can change any time without touching the
-- commission tree.
alter table analysts add column if not exists assigned_leader_id uuid references analysts(id);

-- Swap the status vocabulary from the placeholder (active/inactive/terminated)
-- to the real approval workflow. 'terminated' is kept for offboarding
-- (still drives the customer_ownership_history reassignment logic).
--
-- Order matters both ways here: drop the OLD constraint first (otherwise it
-- blocks the UPDATE below from writing 'approved'/'rejected', values it
-- doesn't recognize), then remap the existing test rows, THEN add the NEW
-- constraint (otherwise it rejects the still-old-vocabulary rows).
alter table analysts drop constraint if exists analysts_status_check;
alter table analysts alter column status drop default;

update analysts set status = 'approved' where status = 'active';
update analysts set status = 'rejected' where status = 'inactive';

alter table analysts add constraint analysts_status_check
  check (status in ('pending', 'approved', 'suspended', 'rejected', 'terminated'));
alter table analysts alter column status set default 'pending';

-- ---- registration_orders: uploaded documents + admin review trail ----
alter table registration_orders add column if not exists ic_document_url text;
alter table registration_orders add column if not exists bank_statement_url text; -- optional
alter table registration_orders add column if not exists payment_screenshot_url text;
alter table registration_orders add column if not exists reviewed_by uuid references users(id);
alter table registration_orders add column if not exists reviewed_at timestamptz;
alter table registration_orders add column if not exists rejection_reason text;

-- ---- storage: private buckets for the three document types ----
-- All uploads and reads go through the service-role client server-side
-- (registration Server Action writes; admin review page reads via signed
-- URLs) — nothing here needs to be reachable directly by anon/authenticated
-- clients, so no storage.objects policies are added. Service role bypasses
-- storage RLS the same way it bypasses table RLS.
insert into storage.buckets (id, name, public)
values
  ('ic-documents', 'ic-documents', false),
  ('bank-statements', 'bank-statements', false),
  ('payment-screenshots', 'payment-screenshots', false)
on conflict (id) do nothing;
