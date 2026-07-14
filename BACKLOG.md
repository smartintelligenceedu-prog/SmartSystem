# Backlog

Non-urgent gaps and known limitations, tracked here instead of blocking active work. Last reviewed 2026-07-14 against the v0.7 architecture proposal (`web` scratchpad `tqc-architecture.html`) and the live codebase.

## FIN-06 — General ledger posting is incomplete

Institutional (B2B) orders auto-post to `journal_entries`/`journal_lines` via `handle_invoice_issued()` / `handle_payment_recorded()` (see `finance_engine.sql`), but the consumer detection-service side (walk-in pay-now/voucher orders) and commission payouts do not post to the chart of accounts at all. The admin Dashboard's "Net Profit" figure is an explicit simplified estimate (`Monthly Sales − commission payouts`), not a real P&L derived from `chart_of_accounts`/`journal_entries` — see the note already printed on `/admin` for back-office users. Closing this gap means extending the same auto-posting trigger pattern to `orders`/`commission_records` for the `immediate` billing mode.

## Agent Dashboard — retail vs. B2B order counts are conflated

`_dashboard/agent-section.tsx`'s "销售订单总数" / "待处理订单" stats filter `order_items` by `order_type = 'detection_service'`, which both consumer walk-in orders and institutional B2B orders share (only `orders.billing_mode` tells them apart). An analyst's institutional orders are currently double-counted into their personal retail sales stats. Fix: add a `billing_mode = 'immediate'` filter (or split into two stats) once someone needs the personal-sales number to be exact — not urgent since it's a display-only stat, not a financial figure.

## Schema-only modules (no application code yet)

These tables exist in `schema.sql` (drafted from the original v0.7 architecture proposal) but have zero corresponding pages, Server Actions, or data-layer code. Scope them as their own task when the business actually needs them — building them speculatively now would be guessing at requirements that haven't been asked for yet.

- **PCR-08 Procurement & Inventory** — `suppliers`, `purchase_orders`, `po_items`, `consumable_items`, `stock_movements`.
- **HR-09 HR & Payroll** — `employees`, `attendance`, `leave_requests`, `payroll_runs`, `payslips`.
- **NTF-11 Notification** — `notifications` table exists; no Email/SMS/LINE integration of any kind.
- **AST-04 Device & Asset Management (remainder)** — the 2026-07-14 patch created `devices`/`detection_centers`/`detection_appointments`/`detection_sessions` for the device-conflict-guard feature, but `device_assignments`, `device_maintenance_logs`, and `device_incidents` (assignment history, maintenance log, loss/damage tracking) are still schema-only.
- **TRN-02 Analyst Training & Certification (remainder)** — the 2026-07-14 patch added a single manual `analysts.certification_passed_at` flag + admin approve button as a stopgap. `training_courses`, `training_enrollments`, `certification_exams`, `certification_records` remain schema-only; there is no actual course/exam content or tracking.
