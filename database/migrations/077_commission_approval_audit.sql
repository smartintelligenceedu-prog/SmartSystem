-- adminApproveCommission() (commission/actions.ts) only ever flipped
-- status 'pending' -> 'approved' with nothing recording who did it or when
-- — audit_logs has no commission_record entries either, so there was
-- genuinely no way to answer "when/who approved this commission" after the
-- fact. Mirrors the existing adjusted_by/adjusted_at manual-override trail
-- already on this table.

alter table commission_records add column if not exists approved_at timestamptz;
alter table commission_records add column if not exists approved_by uuid references users(id);
