-- ============================================================================
-- Migration 038 — introducer-to-customer lead capture (2026-07-17, CTO
-- request): an introducer currently has no way to bring in a prospect
-- themselves — only an analyst, logged into the portal, could create a
-- customer record and manually pick the introducer from a dropdown. This
-- adds a public "just leave your name and phone" link per introducer that
-- routes straight to the analyst responsible for that introducer.
--
-- Two small additions to the existing (previously unused) `leads` table
-- design:
--   1. introducers.assigned_analyst_id — the analyst this introducer's
--      referrals should route to. Back office sets this once per
--      introducer; nullable, since it wasn't required before and existing
--      introducers won't have one set until back office assigns it.
--   2. leads.introducer_id — which introducer sent this lead, so
--      commission attribution carries through when the lead is converted
--      into a real customers row (acquired_via_introducer_id).
--
-- leads.assigned_analyst_id already existed (unused) and already has RLS
-- scoping it to that analyst (or back office) — see rls_policies.sql. No
-- RLS change needed here.
--
-- Self-contained + idempotent: every statement guarded, safe to rerun.
-- ============================================================================

alter table introducers add column if not exists assigned_analyst_id uuid references analysts(id);
alter table leads add column if not exists introducer_id uuid references introducers(id);
create index if not exists idx_leads_introducer on leads(introducer_id) where introducer_id is not null;
