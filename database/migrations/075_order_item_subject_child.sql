-- Lets a "pay now" sales order record WHICH person a detection_session line
-- item is actually for, when the billed customer is a parent account with
-- multiple registered children (customer_children). Previously order_items
-- only carried customer_id (the parent/adult account) — back office
-- reviewing a payment screenshot, or anyone reconciling an order against the
-- report backend later, had no way to tell which child (if any) a line was
-- for until the appointment/report was actually created, several steps
-- later. Null means the subject is the customer themselves (adult
-- self-assessment), matching the same null-means-self convention already
-- used by detection_sessions.child_id and tqc_one_page_reports.child_id.

alter table order_items add column if not exists subject_child_id uuid references customer_children(id);
create index if not exists idx_order_items_subject_child on order_items(subject_child_id);
