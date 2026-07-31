-- New feature: an image-based promotional voucher/media library ("Voucher
-- Portal") — unrelated to the existing detection_vouchers/institutional_vouchers
-- (those are text/numeric redemption credits with no imagery). Back office
-- uploads a voucher card (title + image); introducers (and anyone else
-- logged in) browse the active ones. No redemption/tracking logic — this is
-- purely a media gallery, matching what was actually asked for.

create table if not exists marketing_vouchers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  image_path text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_marketing_vouchers_active_sort on marketing_vouchers (is_active, sort_order);

alter table marketing_vouchers enable row level security;

drop policy if exists "back office manages marketing vouchers" on marketing_vouchers;
create policy "back office manages marketing vouchers" on marketing_vouchers for all
  using (is_back_office())
  with check (is_back_office());

drop policy if exists "authenticated reads active marketing vouchers" on marketing_vouchers;
create policy "authenticated reads active marketing vouchers" on marketing_vouchers for select
  using (is_active = true or is_back_office());

-- Public bucket (unlike ic-documents/payment-screenshots): voucher card
-- images are promotional material meant to be freely viewable, so a plain
-- public URL is used instead of the private-bucket + signed-URL pattern —
-- no PII/sensitive content involved.
insert into storage.buckets (id, name, public)
values ('voucher-images', 'voucher-images', true)
on conflict (id) do nothing;
