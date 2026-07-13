import { PERSONALITY_TYPES } from "@/app/admin/(protected)/customers/children/[id]/report/brain-zones";

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
