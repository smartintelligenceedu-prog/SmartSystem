-- ============================================================================
-- Migration 003 — Remove bank statement upload
-- Bank details (name/account holder/account number) stay as plain form
-- fields; the optional supporting-document upload is dropped entirely.
-- ============================================================================

alter table registration_orders drop column if exists bank_statement_url;

-- Supabase blocks direct DELETE on storage.objects/storage.buckets (a
-- protect_delete() trigger enforces going through the Storage API instead).
-- The 'bank-statements' bucket is removed separately via that API.
