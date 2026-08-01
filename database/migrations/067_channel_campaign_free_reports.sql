-- ============================================================================
-- Migration 067 — Free/complimentary diagnostic reports for PIC institutional
-- visits (Marketing/Promotional Expense tracking)
--
-- When a PIC visits an institution's director/decision-maker and gives away
-- a free diagnostic report as part of the sales pitch, it carries a real
-- report-production cost but generates $0 revenue and no receivable. Booking
-- this through orders/order_items (like a real detection session) would risk
-- it being picked up by the revenue-recognition triggers
-- (handle_invoice_issued/handle_payment_recorded) or the commission engine,
-- both of which key off orders — so this is a deliberately standalone,
-- direct-entry record (same posting shape as manual_expense in
-- finance/actions.ts), fully isolated from those triggers, while still
-- giving PIC + institution attribution via channel_campaigns.campaign_id and
-- a real ledger trail via journal_entry_id.
-- ============================================================================

insert into chart_of_accounts (code, name, account_type) values
  ('6200', 'Marketing Expense - Free Diagnostic Reports', 'expense')
on conflict (code) do nothing;

create table if not exists channel_campaign_free_reports (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references channel_campaigns(id),
  recipient_name text not null,
  report_tier text not null check (report_tier in ('standard', 'upgrade')),
  -- Denormalized snapshot of the report cost at grant time (from
  -- settings.report_cost, same source calculate_report_override_commission()
  -- reads) — kept even if the configurable rate changes later, matching how
  -- order_items/commission_records already snapshot amounts rather than
  -- re-deriving them from current settings on every read.
  cost numeric(12,2) not null,
  notes text,
  posted_by uuid references users(id),
  journal_entry_id uuid references journal_entries(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_channel_campaign_free_reports_campaign on channel_campaign_free_reports(campaign_id);

alter table channel_campaign_free_reports enable row level security;
drop policy if exists "back office only" on channel_campaign_free_reports;
create policy "back office only" on channel_campaign_free_reports for all
  using (is_back_office()) with check (is_back_office());
