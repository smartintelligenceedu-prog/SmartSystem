-- ============================================================================
-- Migration 039 — per-user language preference (2026-07-20, CTO request):
-- go-live prep needs a real zh/en switcher (see AGENTS.md's original plan for
-- one living under Profile → Language). The preference is stored here so it
-- follows a user across devices/browsers; the runtime "what to render right
-- now" source is a `locale` cookie synced from this column at login and on
-- every switch (see web/src/lib/i18n.ts and the setLocale Server Action).
--
-- Self-contained + idempotent: safe to rerun.
-- ============================================================================

alter table users add column if not exists locale text not null default 'zh';

do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'users' and constraint_name = 'users_locale_check'
  ) then
    alter table users add constraint users_locale_check check (locale in ('zh', 'en'));
  end if;
end $$;
