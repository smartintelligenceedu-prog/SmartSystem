-- Migration 040: let an agent "request" an invoice for their own institutional
-- order instead of issuing it themselves. Agents get read-only access to
-- Finance -> Institutional scoped to their own orders (order_items.analyst_id),
-- plus a "Request Invoice" button that just stamps this timestamp so back
-- office sees a flag on their own list — no invoice/payment action is ever
-- performed by the agent. Nullable, no default: null means never requested.
alter table orders add column if not exists invoice_requested_at timestamptz;
