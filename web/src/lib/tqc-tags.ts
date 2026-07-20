import { PERSONALITY_TYPES } from "@/app/admin/(protected)/customers/children/[id]/report/brain-zones";
import { t, type TranslationKey } from "@/lib/i18n";

// Maps customer_children.tags entries (semantic keys written by
// derive_child_tags_one_page(), migration 020) to their i18n key — the tags
// array itself never stores display text, only keys. Personality-type tags
// reuse each type's own nameKey (same text shown in the report's
// personality panel), so adding a new personality type only means editing
// PERSONALITY_TYPES + zh.json — never this file.
export const TQC_TAG_I18N_KEY: Record<string, string> = {
  ...Object.fromEntries(PERSONALITY_TYPES.map((p) => [p.value, p.nameKey])),
  learning_motivation: "tqc.tag.learning_motivation",
  learning_thinking: "tqc.tag.learning_thinking",
  learning_tactile: "tqc.tag.learning_tactile",
  learning_auditory: "tqc.tag.learning_auditory",
  learning_visual: "tqc.tag.learning_visual",
};

// t() is async (locale-aware, see src/lib/i18n.ts) and can't be called
// inside a plain (non-async) .map() callback in a Server Component render —
// callers resolve every tag label they'll need up front (usually via
// Promise.all over the distinct tags in a list) and pass the resulting
// lookup into the render instead.
export async function buildTagLabelMap(tags: string[]): Promise<Record<string, string>> {
  const distinct = [...new Set(tags)];
  const labels = await Promise.all(distinct.map((tag) => t((TQC_TAG_I18N_KEY[tag] ?? tag) as TranslationKey)));
  return Object.fromEntries(distinct.map((tag, i) => [tag, labels[i]]));
}
