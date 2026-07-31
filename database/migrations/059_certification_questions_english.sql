-- Adds English translations for the certification exam question bank so the
-- exam can be taken in either language. Nullable/optional: rows without an
-- English translation yet simply fall back to the Chinese text at read time.
alter table certification_questions add column if not exists question_text_en text;
alter table certification_questions add column if not exists choices_en jsonb;
