-- Switches the default UI language from Chinese to English, confirmed with
-- the user to apply both to new signups going forward AND to every existing
-- account's already-stored preference (they can still switch back to
-- Chinese themselves via the existing LocaleSwitcher).
alter table users alter column locale set default 'en';
update users set locale = 'en';
