-- ============================================================================
-- TQC Business Management System — Seed data (v1.0)
-- Apply after schema.sql + rls_policies.sql + commission_engine.sql.
--
-- ⚠ commission_rules below use a flat 10% PLACEHOLDER rate for every trigger
-- type and level. These are not real business figures — nobody has decided
-- the actual percentages yet (see the v0.6 architecture doc, open item on
-- commission rates). Edit the `rate_percent` values via the back-office
-- before any real money moves. Nothing else about the schema needs to
-- change when you do — that's the whole point of commission_rules being
-- data, not code.
-- ============================================================================

insert into roles (name, description) values
  ('admin', '完整后台权限，含系统设定'),
  ('finance', '财务/佣金相关权限'),
  ('back_office', '一般后台权限（客服/行政）')
on conflict (name) do nothing;

insert into registration_kits (name, price, voucher_self_use_count, voucher_resale_count, includes_business_card, version, is_active)
values ('TQC 分析师注册套装', 688, 1, 1, true, 'v1', true);

insert into compensation_plans (name, version, effective_from, is_active)
values ('Default Compensation Plan', 'v1', current_date, true);

insert into commission_rules (plan_id, trigger_type, level_number, rate_percent, effective_from)
select id, trigger_type, level_number, 10.00, current_date
from compensation_plans,
  (values
    ('personal_sale', 1),
    ('pic_channel', 1),
    ('introducer', 1),
    ('recruitment', 1),
    ('recruitment', 2),
    ('recruitment', 3),
    ('voucher_resale', 0)
  ) as rules(trigger_type, level_number)
where compensation_plans.name = 'Default Compensation Plan';
