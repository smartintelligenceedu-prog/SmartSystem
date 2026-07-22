-- Migration 041: let an analyst's own /register-introducer?ref=<code> link
-- auto-bind the resulting introducer to them. This column carries the
-- referring analyst through from public application submission to admin
-- approval, where it becomes introducers.assigned_analyst_id (migration 038)
-- — admin can still reassign it afterward from Introducer Management like
-- any other assigned_analyst_id, this only sets the initial value.
alter table introducer_applications add column if not exists referring_analyst_id uuid references analysts(id);
