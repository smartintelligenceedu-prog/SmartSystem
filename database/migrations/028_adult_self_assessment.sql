-- ============================================================================
-- Migration 028 — Let a customer be assessed directly (not only their
-- children). 2026-07-14 CTO request: some customers are adults being
-- detected themselves, not parents booking for a child, but every table in
-- the TQC pipeline (tqc_one_page_reports, and by extension the CRM tag
-- system) was built assuming the subject is always a customer_children row.
--
-- detection_appointments/detection_sessions already had a nullable child_id
-- (migration 021/022) — only tqc_one_page_reports and the tag-derivation
-- trigger needed to change here.
--
-- Design: tqc_one_page_reports gets a new nullable customer_id column
-- alongside the now-nullable child_id, with a check constraint enforcing
-- exactly one is set ("who is this report about" is always unambiguous).
-- customers gets its own tags column (mirroring customer_children.tags) so
-- an adult subject's CRM tags land on the customer row directly instead of
-- a synthetic child record.
--
-- Self-contained + idempotent: alter-column/add-column-if-not-exists/
-- drop-constraint-if-exists/create-or-replace are all safe to rerun.
-- ============================================================================

alter table tqc_one_page_reports alter column child_id drop not null;
alter table tqc_one_page_reports add column if not exists customer_id uuid references customers(id);

alter table tqc_one_page_reports drop constraint if exists chk_tqc_report_subject;
alter table tqc_one_page_reports add constraint chk_tqc_report_subject check (
  (child_id is not null and customer_id is null) or (child_id is null and customer_id is not null)
);

create index if not exists idx_tqc_one_page_reports_customer on tqc_one_page_reports(customer_id);

alter table customers add column if not exists tags text[] not null default '{}';

create or replace function derive_child_tags_one_page()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tags text[] := '{}';
  v_latest_recorded_at timestamptz;
  v_style text;
begin
  if new.child_id is not null then
    select max(recorded_at) into v_latest_recorded_at
    from tqc_one_page_reports
    where child_id = new.child_id;
  else
    select max(recorded_at) into v_latest_recorded_at
    from tqc_one_page_reports
    where customer_id = new.customer_id;
  end if;

  if new.recorded_at < v_latest_recorded_at then
    return new;
  end if;

  v_tags := array_append(v_tags, new.personality_type);

  foreach v_style in array new.learning_styles loop
    v_tags := array_append(v_tags, 'learning_' || v_style);
  end loop;

  if new.child_id is not null then
    update customer_children set tags = v_tags, updated_at = now() where id = new.child_id;
  else
    update customers set tags = v_tags, updated_at = now() where id = new.customer_id;
  end if;

  return new;
end;
$$;

-- RLS: the existing SELECT policy only ever joined through child_id, so it
-- would silently never match a customer_id-based (self) report. The app's
-- reads all go through the service-role admin client today (bypassing RLS
-- entirely, same as every other data.ts in this codebase), so this isn't a
-- live bug yet — but it's fixed here for correctness/defense-in-depth.
drop policy if exists "analyst reads own customers' children one-page reports, back office reads all" on tqc_one_page_reports;
create policy "analyst reads own customers' children one-page reports, back office reads all"
  on tqc_one_page_reports for select
  using (
    is_back_office()
    or exists (
      select 1 from customer_children cc
      join customers c on c.id = cc.customer_id
      where cc.id = tqc_one_page_reports.child_id and c.owner_analyst_id = current_analyst_id()
    )
    or exists (
      select 1 from customer_children cc
      join customers c on c.id = cc.customer_id
      where cc.id = tqc_one_page_reports.child_id and c.acquired_via_introducer_id = current_introducer_id()
    )
    or exists (
      select 1 from customers c
      where c.id = tqc_one_page_reports.customer_id and c.owner_analyst_id = current_analyst_id()
    )
    or exists (
      select 1 from customers c
      where c.id = tqc_one_page_reports.customer_id and c.acquired_via_introducer_id = current_introducer_id()
    )
  );
