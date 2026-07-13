-- ============================================================================
-- TQC Business Management System — Database Schema (v1.0)
-- Target: Supabase (PostgreSQL)
-- Companion file: rls_policies.sql (row-level security, apply after this file)
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- Reusable updated_at trigger
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. IDENTITY & PARTY
-- ============================================================================

create table parties (
  id uuid primary key default gen_random_uuid(),
  party_type text not null check (party_type in ('individual', 'organization')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table individuals (
  party_id uuid primary key references parties(id),
  full_name text not null,
  nickname text,
  ic_or_passport_no text,
  date_of_birth date,
  gender text check (gender in ('male', 'female', 'other', 'undisclosed')),
  phone text,
  email text
);

create table organizations (
  party_id uuid primary key references parties(id),
  legal_name text not null,
  registration_no text,
  industry text,
  phone text,
  email text
);

create table addresses (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties(id),
  line1 text not null,
  line2 text,
  city text,
  state text,
  postcode text,
  country text not null default 'MY',
  is_primary boolean not null default true
);

create table users (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties(id),
  auth_user_id uuid not null unique, -- maps to Supabase auth.users.id
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, -- e.g. 'admin', 'finance', 'back_office', 'analyst'
  description text
);

create table user_roles (
  user_id uuid not null references users(id),
  role_id uuid not null references roles(id),
  granted_by uuid references users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

-- ============================================================================
-- 2. SYSTEM / ORGANIZATION STRUCTURE
-- ============================================================================

create table branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  branch_type text not null default 'hq' check (branch_type in ('hq', 'detection_center')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table detection_centers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id),
  name text not null,
  address text,
  operating_hours text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 3. ANALYST NETWORK (core of the compensation structure)
-- ============================================================================

create table analyst_ranks (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  level_order int not null,
  requirements text
);

create table analysts (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties(id),
  sponsor_id uuid references analysts(id), -- Introducer / recruiter; self-referencing tree, drives commission, root = null
  assigned_leader_id uuid references analysts(id), -- operational team assignment; independent of sponsor_id, admin-editable. Since migration 015, this IS a commission recipient: the RM40 report-override commission (see commission_engine.sql)
  rank_id uuid references analyst_ranks(id),
  registration_order_id uuid, -- FK added later (registration_orders is defined after this table)
  referral_code text not null unique default replace(gen_random_uuid()::text, '-', ''), -- shareable code new recruits sign up under
  is_pic boolean not null default false, -- Person In Charge of a channel campaign (school/roadshow outreach)
  branch_id uuid references branches(id),
  bank_name text,
  bank_account_name text,
  bank_account_no text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'suspended', 'rejected', 'terminated')),
  joined_at timestamptz not null default now(),
  terminated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_analysts_sponsor_id on analysts(sponsor_id);
create index idx_analysts_party_id on analysts(party_id);
create index idx_analysts_assigned_leader_id on analysts(assigned_leader_id);

create table introducers (
  -- NOT part of the analyst hierarchy: a pure external referral channel (e.g. a clinic contact).
  -- No training, no rank — just identity + payout details. Introducers CAN
  -- refer other introducers (sponsor_id, mirrors analysts.sponsor_id), which
  -- pays a 2-level introducer commission — see introducer_sponsor_at_level()
  -- in commission_engine.sql.
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties(id),
  sponsor_id uuid references introducers(id),
  referral_code text not null unique,
  bank_name text,
  bank_account_name text,
  bank_account_no text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_introducers_sponsor on introducers(sponsor_id);

create table channel_campaigns (
  -- School / institution / roadshow outreach run by a PIC analyst.
  id uuid primary key default gen_random_uuid(),
  name text not null,
  campaign_type text not null check (campaign_type in ('school', 'institution', 'roadshow', 'other')),
  pic_analyst_id uuid not null references analysts(id),
  location text,
  start_date date,
  end_date date,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);
create index idx_channel_campaigns_pic on channel_campaigns(pic_analyst_id);

-- ============================================================================
-- 4. CRM
-- ============================================================================

create table leads (
  id uuid primary key default gen_random_uuid(),
  contact_name text not null,
  phone text,
  email text,
  source text,
  assigned_analyst_id uuid references analysts(id),
  status text not null default 'new' check (status in ('new', 'contacted', 'converted', 'lost')),
  converted_customer_id uuid, -- FK added after customers table exists
  created_at timestamptz not null default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties(id),
  owner_analyst_id uuid not null references analysts(id), -- who this customer "belongs to" for CRM visibility
  acquired_via_campaign_id uuid references channel_campaigns(id), -- PIC attribution (nullable)
  acquired_via_introducer_id uuid references introducers(id), -- Introducer attribution (nullable)
  branch_id uuid references branches(id),
  status text not null default 'active' check (status in ('active', 'inactive')), -- "Archive" in the UI sets this to 'inactive'
  occupation text,
  marital_status text check (marital_status is null or marital_status in ('single', 'married', 'divorced', 'widowed', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_customers_owner on customers(owner_analyst_id);
create index idx_customers_campaign on customers(acquired_via_campaign_id);
create index idx_customers_introducer on customers(acquired_via_introducer_id);

-- IC/passport, date_of_birth, gender, phone, email all live on individuals
-- (via customers.party_id) — no separate columns needed here. Address
-- reuses the generic addresses table the same way.

create table customer_children (
  -- Age is deliberately not stored — derive it from date_of_birth in the UI,
  -- since a stored age goes stale the day after it's entered.
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  full_name text not null,
  gender text check (gender in ('male', 'female', 'other', 'undisclosed')),
  date_of_birth date,
  school text,
  remark text,
  -- Tag KEYS only ('owl_smart', 'learning_visual', ...), never display
  -- text — translated at the UI layer via t(`tqc.tag.${key}`). Auto-derived
  -- by derive_child_tags_one_page() (migration 020) from the child's most
  -- recent tqc_one_page_reports row; never written to directly by the app.
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_customer_children_customer on customer_children(customer_id);
create trigger set_updated_at before update on customer_children for each row execute function set_updated_at();

-- TQC one-page (A4 golden-layout) brain report (migration 020, replacing
-- the abandoned radar-chart tqc_reports from migration 019). One row per
-- assessment (a child can be retested); report page/tags always use the
-- most recent row per child_id. Ten brain-zone columns renamed from the
-- brief's A-E/a-e scheme (which would have collided under Postgres's
-- lowercase identifier folding) to fully distinct names, preserving the
-- original letter order 1:1 — see migration 020's header comment for the
-- full mapping.
create table tqc_one_page_reports (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references customer_children(id),
  created_by_analyst_id uuid references analysts(id),
  recorded_at timestamptz not null default now(),

  left_brain_pct numeric(5,2) not null check (left_brain_pct between 0 and 100),
  right_brain_pct numeric(5,2) not null check (right_brain_pct between 0 and 100),

  brain_zone_a_organization numeric(5,2) not null check (brain_zone_a_organization between 0 and 100),
  brain_zone_b_logic numeric(5,2) not null check (brain_zone_b_logic between 0 and 100),
  brain_zone_c_motor numeric(5,2) not null check (brain_zone_c_motor between 0 and 100),
  brain_zone_d_language numeric(5,2) not null check (brain_zone_d_language between 0 and 100),
  brain_zone_e_reading numeric(5,2) not null check (brain_zone_e_reading between 0 and 100),
  brain_zone_f_creativity numeric(5,2) not null check (brain_zone_f_creativity between 0 and 100),
  brain_zone_g_spatial numeric(5,2) not null check (brain_zone_g_spatial between 0 and 100),
  brain_zone_h_artistic numeric(5,2) not null check (brain_zone_h_artistic between 0 and 100),
  brain_zone_i_emotion numeric(5,2) not null check (brain_zone_i_emotion between 0 and 100),
  brain_zone_j_visual numeric(5,2) not null check (brain_zone_j_visual between 0 and 100),

  -- Plain text, not a checked enum — only 'owl_smart' has confirmed content
  -- so far; tighten once the full animal/archetype list is provided.
  personality_type text not null,

  tqc_activity_score numeric(6,2) not null check (tqc_activity_score >= 0),
  tqc_stars int not null check (tqc_stars between 0 and 5),

  -- 'motivation' | 'thinking' | 'tactile' | 'auditory' | 'visual'
  learning_styles text[] not null default '{}',

  analyst_summary text,

  created_at timestamptz not null default now()
);
create index idx_tqc_one_page_reports_child on tqc_one_page_reports(child_id);

alter table leads add constraint fk_leads_converted_customer
  foreign key (converted_customer_id) references customers(id);

create table customer_ownership_history (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  previous_owner_analyst_id uuid references analysts(id),
  new_owner_analyst_id uuid not null references analysts(id),
  reason text not null check (reason in ('voluntary_reassign', 'offboarding', 'dispute')),
  changed_by uuid references users(id),
  changed_at timestamptz not null default now()
);

create table customer_consents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  consent_type text not null default 'detection_service',
  consent_version text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table interactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  analyst_id uuid references analysts(id),
  interaction_type text not null,
  notes text,
  occurred_at timestamptz not null default now()
);

-- ============================================================================
-- 5. ANALYST TRAINING & CERTIFICATION
-- ============================================================================

create table training_courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  version text not null default 'v1',
  is_active boolean not null default true
);

create table training_enrollments (
  id uuid primary key default gen_random_uuid(),
  analyst_id uuid not null references analysts(id),
  course_id uuid not null references training_courses(id),
  status text not null default 'enrolled' check (status in ('enrolled', 'in_progress', 'completed', 'dropped')),
  enrolled_at timestamptz not null default now(),
  completed_at timestamptz
);

create table certification_exams (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references training_courses(id),
  name text not null,
  passing_score numeric(5,2) not null default 70
);

create table certification_records (
  id uuid primary key default gen_random_uuid(),
  analyst_id uuid not null references analysts(id),
  exam_id uuid not null references certification_exams(id),
  score numeric(5,2),
  result text not null check (result in ('pass', 'fail')),
  certified_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_certification_records_analyst on certification_records(analyst_id);

-- ============================================================================
-- 6. DEVICE & ASSET MANAGEMENT
-- ============================================================================

create table devices (
  id uuid primary key default gen_random_uuid(),
  serial_no text not null unique,
  model text,
  status text not null default 'active' check (status in ('active', 'maintenance', 'lost', 'retired')),
  current_center_id uuid references detection_centers(id),
  current_analyst_id uuid references analysts(id),
  purchased_at date,
  warranty_until date,
  next_maintenance_due date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_device_single_holder check (
    not (current_center_id is not null and current_analyst_id is not null)
  )
);

create table device_assignments (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id),
  assigned_to_type text not null check (assigned_to_type in ('center', 'analyst')),
  assigned_to_center_id uuid references detection_centers(id),
  assigned_to_analyst_id uuid references analysts(id),
  assigned_at timestamptz not null default now(),
  returned_at timestamptz,
  assigned_by uuid references users(id)
);

create table device_maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id),
  maintenance_type text not null,
  performed_at timestamptz not null default now(),
  performed_by text,
  notes text,
  cost numeric(12,2)
);

create table device_incidents (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id),
  incident_type text not null check (incident_type in ('loss', 'damage')),
  reported_by uuid references users(id),
  reported_at timestamptz not null default now(),
  liable_analyst_id uuid references analysts(id),
  charge_amount numeric(12,2),
  resolution text,
  resolved_at timestamptz
);

-- ============================================================================
-- 7. BRAIN DETECTION SERVICE
-- Reports themselves are never stored here — only the fact that a session
-- happened, who performed it, and which device was used (billing/commission
-- trigger + audit trail).
-- ============================================================================

create table detection_appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  analyst_id uuid not null references analysts(id),
  device_id uuid not null references devices(id),
  center_id uuid references detection_centers(id), -- null = outcall/on-site visit
  scheduled_at timestamptz not null,
  duration_minutes int not null default 30,
  time_range tstzrange, -- populated by trg_set_appointment_time_range below
  status text not null default 'booked' check (status in ('booked', 'confirmed', 'completed', 'cancelled', 'no_show')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- time_range can't be a GENERATED column: timestamptz + interval is STABLE,
-- not IMMUTABLE (interval arithmetic is timezone/DST-sensitive in general),
-- and generated columns require an immutable expression. A trigger has no
-- such restriction, so it does the same job.
create or replace function set_appointment_time_range()
returns trigger
language plpgsql
as $$
begin
  new.time_range := tstzrange(new.scheduled_at, new.scheduled_at + (new.duration_minutes || ' minutes')::interval);
  return new;
end;
$$;

create trigger trg_set_appointment_time_range
  before insert or update of scheduled_at, duration_minutes on detection_appointments
  for each row execute function set_appointment_time_range();

-- Availability is checked on the DEVICE only (per business decision — analyst
-- scheduling conflicts are coordinated manually, not enforced by the system).
alter table detection_appointments
  add constraint no_overlapping_device_bookings
  exclude using gist (device_id with =, time_range with &&)
  where (status not in ('cancelled', 'no_show'));

create index idx_appointments_analyst on detection_appointments(analyst_id);
create index idx_appointments_customer on detection_appointments(customer_id);

create table detection_sessions (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references detection_appointments(id),
  customer_id uuid not null references customers(id),
  analyst_id uuid not null references analysts(id),
  device_id uuid not null references devices(id),
  performed_at timestamptz not null default now(),
  status text not null default 'completed' check (status in ('completed', 'voided')),
  order_item_id uuid, -- FK added after order_items exists; links the session to its billing line
  created_at timestamptz not null default now()
);
create index idx_sessions_analyst on detection_sessions(analyst_id);
create index idx_sessions_customer on detection_sessions(customer_id);

-- ============================================================================
-- 8. SALES & ORDER
-- ============================================================================

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_type text not null check (order_type in ('registration', 'detection_service')),
  customer_id uuid references customers(id), -- null for registration orders
  analyst_id uuid references analysts(id), -- who processed / is credited with this sale
  branch_id uuid references branches(id),
  total_amount numeric(12,2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled', 'refunded')),
  -- 'immediate' = today's only mode (consumer walk-in pay-now/voucher flow,
  -- unaffected by this column). 'invoice' = institutional/B2B orders that go
  -- through invoices/payments instead (migration 016) — postToLedger()
  -- explicitly skips these to avoid double-posting revenue, since they're
  -- auto-posted by handle_invoice_issued()/handle_payment_recorded().
  billing_mode text not null default 'immediate' check (billing_mode in ('immediate', 'invoice')),
  -- Only meaningful for billing_mode = 'invoice' orders (migration 017) —
  -- points at a parties row (party_type = 'organization') for printable
  -- invoices/receipts. Reuses the existing organizations/addresses tables
  -- rather than a redundant new "institutions" table.
  institution_party_id uuid references parties(id),
  -- Deprecated as of migration 015 — delivery is now tracked per-report on
  -- order_items.report_delivered_at instead (a multi-person order can have
  -- reports delivered at different times). Column kept for historical data
  -- backfilled into order_items; no longer written to going forward.
  report_delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_orders_analyst on orders(analyst_id);
create index idx_orders_customer on orders(customer_id);
create index idx_orders_institution_party on orders(institution_party_id);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  item_type text not null check (item_type in ('registration_kit', 'detection_session', 'voucher_redemption', 'other')),
  description text,
  unit_price numeric(12,2) not null,
  quantity int not null default 1,
  subtotal numeric(12,2) not null,
  -- Only set for detection_session/voucher_redemption items — lets one
  -- order cover multiple people (e.g. a family visiting together) each with
  -- their own customer and credited agent; commission is calculated per
  -- item against these, not against orders.customer_id/analyst_id. Null for
  -- registration_kit items (unused there).
  customer_id uuid references customers(id),
  analyst_id uuid references analysts(id),
  -- Report delivery is per-item (per-person/per-report), not per-order — a
  -- multi-person order can have different people's reports finish and get
  -- delivered at different times, each independently classified. Setting
  -- report_delivered_at (migration 015) fires the RM40 report-override
  -- commission + report-cost posting trigger; see commission_engine.sql.
  report_tier text check (report_tier in ('standard', 'upgrade')),
  report_delivered_at timestamptz
);
create index idx_order_items_customer on order_items(customer_id);
create index idx_order_items_analyst on order_items(analyst_id);

alter table detection_sessions add constraint fk_sessions_order_item
  foreign key (order_item_id) references order_items(id);

create table registration_kits (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(12,2) not null default 688,
  includes_training_course_id uuid references training_courses(id),
  voucher_self_use_count int not null default 1,
  voucher_resale_count int not null default 1,
  includes_business_card boolean not null default true,
  version text not null default 'v1',
  is_active boolean not null default true
);

create table registration_orders (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties(id), -- the registrant
  kit_id uuid not null references registration_kits(id),
  order_id uuid not null references orders(id),
  sponsor_id uuid references analysts(id), -- who recruited them (the Introducer)
  ic_document_url text,
  payment_screenshot_url text,
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  status text not null default 'pending' check (status in ('pending', 'fulfilled', 'cancelled')),
  created_at timestamptz not null default now()
);

alter table analysts add constraint fk_analysts_registration_order
  foreign key (registration_order_id) references registration_orders(id);

create table detection_vouchers (
  id uuid primary key default gen_random_uuid(),
  registration_order_id uuid not null references registration_orders(id),
  analyst_id uuid not null references analysts(id),
  voucher_type text not null check (voucher_type in ('self_use', 'resale')),
  status text not null default 'issued' check (status in ('locked', 'issued', 'redeemed', 'expired')),
  -- 'resale' vouchers start 'locked' and flip to 'issued' once certification_records shows a pass
  redeemed_session_id uuid references detection_sessions(id),
  issued_at timestamptz not null default now(),
  unlocked_at timestamptz,
  redeemed_at timestamptz
);
create index idx_vouchers_analyst on detection_vouchers(analyst_id);

create table sales_orders (
  -- Side-table for order_type = 'detection_service' orders that need payment
  -- verification, mirroring how registration_orders is the side-table for
  -- order_type = 'registration' — orders itself stays generic. Only created
  -- for the "customer pays now, screenshot + back-office review" path;
  -- voucher-redemption orders go straight to orders.status = 'paid' with no
  -- row here, since there is nothing for back office to verify (the customer
  -- already paid the analyst directly for a resold voucher).
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  payment_screenshot_url text not null,
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
create index idx_sales_orders_order on sales_orders(order_id);

-- ============================================================================
-- 9. COMMISSION ENGINE
-- Six trigger types, each independently configurable and versioned so that
-- rate changes never rewrite historical commission_records. 'report_override'
-- (migration 015) is delivery-triggered (order_items.report_delivered_at),
-- not sale-triggered like the other five — see commission_engine.sql.
-- ============================================================================

create table compensation_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text not null,
  effective_from date not null,
  effective_to date,
  is_active boolean not null default true
);

create table commission_rules (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references compensation_plans(id),
  trigger_type text not null check (
    trigger_type in ('personal_sale', 'pic_channel', 'introducer', 'recruitment', 'voucher_resale', 'report_override')
  ),
  level_number int not null default 1, -- 1 = direct sponsor, 2 = sponsor's sponsor, etc.
  calculation_type text not null default 'percentage' check (calculation_type in ('percentage', 'flat')),
  rate_percent numeric(5,2), -- required when calculation_type = 'percentage'
  flat_amount numeric(12,2), -- required when calculation_type = 'flat'
  cap_amount numeric(12,2), -- optional; null = no cap (current business decision)
  effective_from date not null,
  effective_to date,
  constraint chk_commission_rule_calculation check (
    (calculation_type = 'percentage' and rate_percent is not null and flat_amount is null) or
    (calculation_type = 'flat' and flat_amount is not null and rate_percent is null)
  )
);
create index idx_commission_rules_plan on commission_rules(plan_id, trigger_type);

create table commission_records (
  id uuid primary key default gen_random_uuid(),
  trigger_type text not null check (
    trigger_type in ('personal_sale', 'pic_channel', 'introducer', 'recruitment', 'voucher_resale', 'report_override')
  ),
  -- polymorphic reference to the originating transaction (order, registration_order, ...);
  -- intentionally not FK-constrained since it can point at more than one table
  source_transaction_type text not null,
  source_transaction_id uuid not null,
  level_number int not null default 0,
  analyst_id uuid references analysts(id),
  introducer_id uuid references introducers(id),
  calculation_type text not null default 'percentage' check (calculation_type in ('percentage', 'flat')),
  rate_applied numeric(5,2), -- null when calculation_type = 'flat'
  base_amount numeric(12,2) not null,
  commission_amount numeric(12,2) not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'reversed')),
  calculated_at timestamptz not null default now(),
  paid_at timestamptz,
  -- manual override trail — original_amount is only ever set the first time
  -- someone overrides the auto-calculated commission_amount, so it always
  -- reflects what the engine originally computed, not the latest edit.
  original_amount numeric(12,2),
  adjusted_by uuid references users(id),
  adjusted_at timestamptz,
  adjustment_reason text,
  constraint chk_commission_payee check (
    (analyst_id is not null and introducer_id is null) or
    (analyst_id is null and introducer_id is not null)
  )
);
create index idx_commission_records_analyst on commission_records(analyst_id);
create index idx_commission_records_introducer on commission_records(introducer_id);

-- ============================================================================
-- 10. FINANCE
-- ============================================================================

create table chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_type text not null check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id uuid references chart_of_accounts(id)
);

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  source_type text not null, -- e.g. 'order', 'commission_record'
  source_id uuid,
  description text,
  posted_by text not null default 'system',
  posted_at timestamptz not null default now()
);

create table journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references journal_entries(id),
  account_id uuid not null references chart_of_accounts(id),
  debit numeric(12,2) not null default 0,
  credit numeric(12,2) not null default 0,
  constraint chk_journal_line_one_sided check (
    (debit = 0 and credit > 0) or (debit > 0 and credit = 0)
  )
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  invoice_no text not null unique,
  amount numeric(12,2) not null, -- always the order's full total_amount, regardless of invoice_type
  -- 'standard' = invoice-first, pay-in-full-later (books Dr AR / Cr Deferred
  -- Revenue). 'final_settlement' = deposit-first, nets the deposit off the
  -- total and recognizes revenue immediately (migration 016).
  invoice_type text not null default 'standard' check (invoice_type in ('standard', 'final_settlement')),
  issued_at timestamptz not null default now(),
  due_at timestamptz,
  status text not null default 'issued' check (status in ('issued', 'paid', 'void'))
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  amount numeric(12,2) not null,
  method text not null,
  -- Which of the three institutional billing moments this is — drives which
  -- accounting entry handle_payment_recorded() posts (migration 016).
  payment_type text not null default 'full_payment' check (payment_type in ('deposit', 'full_payment', 'final_payment')),
  paid_at timestamptz not null default now(),
  reference_no text
);

create table receipts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id),
  receipt_no text not null unique,
  issued_at timestamptz not null default now()
);

-- Institutional bulk-order credits (migration 018) — distinct from
-- detection_vouchers above (which is the analyst registration-kit
-- self_use/resale voucher system). One row per credit purchased on an
-- institutional order (orders.billing_mode = 'invoice'); auto-generated in
-- bulk by generate_institutional_vouchers() (finance_engine.sql) the moment
-- the order reaches 'paid'. used_by_child_id is only set on redemption.
create table institutional_vouchers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  voucher_code text not null unique,
  status text not null default 'unused' check (status in ('unused', 'used', 'cancelled')),
  used_by_child_id uuid references customer_children(id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_institutional_vouchers_order on institutional_vouchers(order_id);
create index idx_institutional_vouchers_status on institutional_vouchers(status);

-- ============================================================================
-- 11. PROCUREMENT & INVENTORY
-- ============================================================================

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties(id),
  category text,
  status text not null default 'active' check (status in ('active', 'inactive'))
);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id),
  status text not null default 'draft' check (status in ('draft', 'ordered', 'received', 'cancelled')),
  ordered_at timestamptz,
  expected_at date
);

create table consumable_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique,
  unit text not null default 'pcs',
  reorder_level int not null default 0,
  current_stock int not null default 0
);

create table po_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id),
  item_id uuid references consumable_items(id),
  description text,
  quantity int not null,
  unit_cost numeric(12,2) not null
);

create table business_card_orders (
  id uuid primary key default gen_random_uuid(),
  analyst_id uuid not null references analysts(id),
  registration_order_id uuid references registration_orders(id),
  design_status text not null default 'pending' check (design_status in ('pending', 'ready')),
  print_status text not null default 'pending' check (print_status in ('pending', 'printed', 'shipped')),
  shipped_at timestamptz,
  tracking_no text
);

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references consumable_items(id),
  movement_type text not null check (movement_type in ('in', 'out', 'adjustment')),
  quantity int not null,
  reference_type text,
  reference_id uuid,
  moved_at timestamptz not null default now()
);

-- ============================================================================
-- 12. HR & PAYROLL (internal employees only — analysts are handled separately)
-- ============================================================================

create table employees (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties(id),
  position text,
  department text,
  employment_type text not null default 'full_time' check (employment_type in ('full_time', 'part_time', 'contract')),
  hired_at date not null default current_date,
  status text not null default 'active' check (status in ('active', 'inactive'))
);

create table attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  work_date date not null,
  clock_in timestamptz,
  clock_out timestamptz,
  status text not null default 'present' check (status in ('present', 'absent', 'leave'))
);

create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  leave_type text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references users(id)
);

create table payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft', 'processed', 'paid')),
  processed_at timestamptz
);

create table payslips (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references payroll_runs(id),
  employee_id uuid not null references employees(id),
  gross_amount numeric(12,2) not null,
  deductions numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null
);

-- ============================================================================
-- 13. SYSTEM / AUDIT
-- ============================================================================

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_party_id uuid references parties(id),
  channel text not null check (channel in ('email', 'sms', 'line', 'in_app')),
  template text not null,
  payload jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  sent_at timestamptz
);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 14. STORAGE — private document buckets for the registration module
-- All uploads/reads go through the service-role client server-side, so no
-- storage.objects policies are needed (service role bypasses storage RLS
-- the same way it bypasses table RLS).
-- ============================================================================

insert into storage.buckets (id, name, public)
values
  ('ic-documents', 'ic-documents', false),
  ('payment-screenshots', 'payment-screenshots', false)
on conflict (id) do nothing;

-- ============================================================================
-- 15. updated_at TRIGGERS (applied to the mutable, non-append-only tables)
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'parties', 'users', 'branches', 'detection_centers', 'analysts', 'introducers',
    'customers', 'devices', 'detection_appointments', 'orders', 'settings'
  ]
  loop
    execute format('create trigger set_updated_at before update on %I for each row execute function set_updated_at()', t);
  end loop;
end;
$$;
