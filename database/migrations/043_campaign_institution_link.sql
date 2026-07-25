-- Migration 043: let a PIC channel campaign optionally carry a formal
-- institution billing identity (party/organization/address, the same model
-- Institutional Orders already uses via orders.institution_party_id) —
-- so an institution set up once at campaign-creation time can be reused
-- when later creating an Institutional Order for the same school/company,
-- instead of retyping SSM/address from scratch every time.
--
-- Nullable: PIC channel campaigns aren't always tied to a formal billing
-- entity (e.g. a public mall roadshow has a PIC analyst but no "institution"
-- to invoice), so this stays optional, not a new required field.
alter table channel_campaigns add column if not exists institution_party_id uuid references parties(id);
create index if not exists idx_channel_campaigns_institution on channel_campaigns(institution_party_id);
