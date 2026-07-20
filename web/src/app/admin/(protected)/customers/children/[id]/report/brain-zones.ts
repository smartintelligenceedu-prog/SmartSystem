// The ten TQC brain zones — shared between the entry form, the one-page
// report layout, and the auto-computed strengths/weaknesses section, so
// there is exactly one place that maps a DB column to its i18n key.
//
// Renamed from the brief's A-E/a-e scheme (which collides under Postgres's
// lowercase identifier folding — brain_zone_A and brain_zone_a are the same
// column) to fully distinct names, preserving the original letter order.
export const BRAIN_ZONES = [
  { field: "brain_zone_a_organization", nameKey: "tqc.zone.organization" },
  { field: "brain_zone_b_logic", nameKey: "tqc.zone.logic" },
  { field: "brain_zone_c_motor", nameKey: "tqc.zone.motor" },
  { field: "brain_zone_d_language", nameKey: "tqc.zone.language" },
  { field: "brain_zone_e_reading", nameKey: "tqc.zone.reading" },
  { field: "brain_zone_f_creativity", nameKey: "tqc.zone.creativity" },
  { field: "brain_zone_g_spatial", nameKey: "tqc.zone.spatial" },
  { field: "brain_zone_h_artistic", nameKey: "tqc.zone.artistic" },
  { field: "brain_zone_i_emotion", nameKey: "tqc.zone.emotion" },
  { field: "brain_zone_j_visual", nameKey: "tqc.zone.visual" },
] as const;

export type BrainZoneField = (typeof BRAIN_ZONES)[number]["field"];

// A zone's percentage share (its QC value ÷ sum of all 10 zones' QC values
// x 100) auto-suggests strength (>= 9%) or weakness (< 9%, "within average
// standard" per the reference material) — but 'potential' (开放性潜能) is
// never auto-assigned, only ever a manual analyst call per zone (migration
// 036). See ZONE_STRENGTH_THRESHOLD_PCT below for the cutoff.
export const ZONE_CATEGORIES = ["strength", "weakness", "potential"] as const;
export type ZoneCategory = (typeof ZONE_CATEGORIES)[number];
export const ZONE_STRENGTH_THRESHOLD_PCT = 9;

export function autoZoneCategory(percentage: number): "strength" | "weakness" {
  return percentage >= ZONE_STRENGTH_THRESHOLD_PCT ? "strength" : "weakness";
}

// score_i / sum(all 10 scores) * 100, rounded to 2dp — matches how the
// reference report's displayed percentages were reverse-derived (see the
// 2026-07-17 conversation): total is "脑活跃度", not a fixed 100-point scale.
export function zonePercentage(score: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((score / total) * 10000) / 100;
}

export const LEARNING_STYLES = [
  { value: "motivation", nameKey: "tqc.learning_style.motivation", icon: "\u{1F525}" },
  { value: "thinking", nameKey: "tqc.learning_style.thinking", icon: "\u{1F9E0}" },
  { value: "tactile", nameKey: "tqc.learning_style.tactile", icon: "✋" },
  { value: "auditory", nameKey: "tqc.learning_style.auditory", icon: "\u{1F442}" },
  { value: "visual", nameKey: "tqc.learning_style.visual", icon: "\u{1F441}️" },
] as const;

export type LearningStyleValue = (typeof LEARNING_STYLES)[number]["value"];

// The full TQC personality taxonomy: 4 animal categories (老虎/无尾熊/猫头鹰/
// 可塑龙) x 19 modifier combinations = 76 personality types. value is
// `${category}_${modifier}`; name is `${modifierLabel}${categoryLabel}`
// (e.g. "聪明型猫头鹰"). Only 16 (each category x its 4 base modifiers —
// brave/gentle/smart/versatile) have official description copy from the
// user; the rest use a clearly-marked "content pending" placeholder rather
// than fabricated psychological claims — see tqc.personality.*.description
// in zh.json. `emoji` stands in for the official animal cartoon artwork
// until that asset exists (shared per category, not per modifier).
export const PERSONALITY_TYPES: { value: string; nameKey: string; descriptionKey: string; emoji: string }[] = [
  { value: "tiger_brave", nameKey: "tqc.personality.tiger_brave.name", descriptionKey: "tqc.personality.tiger_brave.description", emoji: "🐯" },
  { value: "tiger_gentle", nameKey: "tqc.personality.tiger_gentle.name", descriptionKey: "tqc.personality.tiger_gentle.description", emoji: "🐯" },
  { value: "tiger_smart", nameKey: "tqc.personality.tiger_smart.name", descriptionKey: "tqc.personality.tiger_smart.description", emoji: "🐯" },
  { value: "tiger_versatile", nameKey: "tqc.personality.tiger_versatile.name", descriptionKey: "tqc.personality.tiger_versatile.description", emoji: "🐯" },
  { value: "tiger_genius", nameKey: "tqc.personality.tiger_genius.name", descriptionKey: "tqc.personality.tiger_genius.description", emoji: "🐯" },
  { value: "tiger_talent", nameKey: "tqc.personality.tiger_talent.name", descriptionKey: "tqc.personality.tiger_talent.description", emoji: "🐯" },
  { value: "tiger_reverse", nameKey: "tqc.personality.tiger_reverse.name", descriptionKey: "tqc.personality.tiger_reverse.description", emoji: "🐯" },
  { value: "tiger_genius_brave", nameKey: "tqc.personality.tiger_genius_brave.name", descriptionKey: "tqc.personality.tiger_genius_brave.description", emoji: "🐯" },
  { value: "tiger_genius_gentle", nameKey: "tqc.personality.tiger_genius_gentle.name", descriptionKey: "tqc.personality.tiger_genius_gentle.description", emoji: "🐯" },
  { value: "tiger_genius_smart", nameKey: "tqc.personality.tiger_genius_smart.name", descriptionKey: "tqc.personality.tiger_genius_smart.description", emoji: "🐯" },
  { value: "tiger_genius_versatile", nameKey: "tqc.personality.tiger_genius_versatile.name", descriptionKey: "tqc.personality.tiger_genius_versatile.description", emoji: "🐯" },
  { value: "tiger_talent_brave", nameKey: "tqc.personality.tiger_talent_brave.name", descriptionKey: "tqc.personality.tiger_talent_brave.description", emoji: "🐯" },
  { value: "tiger_talent_gentle", nameKey: "tqc.personality.tiger_talent_gentle.name", descriptionKey: "tqc.personality.tiger_talent_gentle.description", emoji: "🐯" },
  { value: "tiger_talent_smart", nameKey: "tqc.personality.tiger_talent_smart.name", descriptionKey: "tqc.personality.tiger_talent_smart.description", emoji: "🐯" },
  { value: "tiger_talent_versatile", nameKey: "tqc.personality.tiger_talent_versatile.name", descriptionKey: "tqc.personality.tiger_talent_versatile.description", emoji: "🐯" },
  { value: "tiger_reverse_brave", nameKey: "tqc.personality.tiger_reverse_brave.name", descriptionKey: "tqc.personality.tiger_reverse_brave.description", emoji: "🐯" },
  { value: "tiger_reverse_gentle", nameKey: "tqc.personality.tiger_reverse_gentle.name", descriptionKey: "tqc.personality.tiger_reverse_gentle.description", emoji: "🐯" },
  { value: "tiger_reverse_smart", nameKey: "tqc.personality.tiger_reverse_smart.name", descriptionKey: "tqc.personality.tiger_reverse_smart.description", emoji: "🐯" },
  { value: "tiger_reverse_versatile", nameKey: "tqc.personality.tiger_reverse_versatile.name", descriptionKey: "tqc.personality.tiger_reverse_versatile.description", emoji: "🐯" },
  { value: "koala_brave", nameKey: "tqc.personality.koala_brave.name", descriptionKey: "tqc.personality.koala_brave.description", emoji: "🐨" },
  { value: "koala_gentle", nameKey: "tqc.personality.koala_gentle.name", descriptionKey: "tqc.personality.koala_gentle.description", emoji: "🐨" },
  { value: "koala_smart", nameKey: "tqc.personality.koala_smart.name", descriptionKey: "tqc.personality.koala_smart.description", emoji: "🐨" },
  { value: "koala_versatile", nameKey: "tqc.personality.koala_versatile.name", descriptionKey: "tqc.personality.koala_versatile.description", emoji: "🐨" },
  { value: "koala_genius", nameKey: "tqc.personality.koala_genius.name", descriptionKey: "tqc.personality.koala_genius.description", emoji: "🐨" },
  { value: "koala_talent", nameKey: "tqc.personality.koala_talent.name", descriptionKey: "tqc.personality.koala_talent.description", emoji: "🐨" },
  { value: "koala_reverse", nameKey: "tqc.personality.koala_reverse.name", descriptionKey: "tqc.personality.koala_reverse.description", emoji: "🐨" },
  { value: "koala_genius_brave", nameKey: "tqc.personality.koala_genius_brave.name", descriptionKey: "tqc.personality.koala_genius_brave.description", emoji: "🐨" },
  { value: "koala_genius_gentle", nameKey: "tqc.personality.koala_genius_gentle.name", descriptionKey: "tqc.personality.koala_genius_gentle.description", emoji: "🐨" },
  { value: "koala_genius_smart", nameKey: "tqc.personality.koala_genius_smart.name", descriptionKey: "tqc.personality.koala_genius_smart.description", emoji: "🐨" },
  { value: "koala_genius_versatile", nameKey: "tqc.personality.koala_genius_versatile.name", descriptionKey: "tqc.personality.koala_genius_versatile.description", emoji: "🐨" },
  { value: "koala_talent_brave", nameKey: "tqc.personality.koala_talent_brave.name", descriptionKey: "tqc.personality.koala_talent_brave.description", emoji: "🐨" },
  { value: "koala_talent_gentle", nameKey: "tqc.personality.koala_talent_gentle.name", descriptionKey: "tqc.personality.koala_talent_gentle.description", emoji: "🐨" },
  { value: "koala_talent_smart", nameKey: "tqc.personality.koala_talent_smart.name", descriptionKey: "tqc.personality.koala_talent_smart.description", emoji: "🐨" },
  { value: "koala_talent_versatile", nameKey: "tqc.personality.koala_talent_versatile.name", descriptionKey: "tqc.personality.koala_talent_versatile.description", emoji: "🐨" },
  { value: "koala_reverse_brave", nameKey: "tqc.personality.koala_reverse_brave.name", descriptionKey: "tqc.personality.koala_reverse_brave.description", emoji: "🐨" },
  { value: "koala_reverse_gentle", nameKey: "tqc.personality.koala_reverse_gentle.name", descriptionKey: "tqc.personality.koala_reverse_gentle.description", emoji: "🐨" },
  { value: "koala_reverse_smart", nameKey: "tqc.personality.koala_reverse_smart.name", descriptionKey: "tqc.personality.koala_reverse_smart.description", emoji: "🐨" },
  { value: "koala_reverse_versatile", nameKey: "tqc.personality.koala_reverse_versatile.name", descriptionKey: "tqc.personality.koala_reverse_versatile.description", emoji: "🐨" },
  { value: "owl_brave", nameKey: "tqc.personality.owl_brave.name", descriptionKey: "tqc.personality.owl_brave.description", emoji: "🦉" },
  { value: "owl_gentle", nameKey: "tqc.personality.owl_gentle.name", descriptionKey: "tqc.personality.owl_gentle.description", emoji: "🦉" },
  { value: "owl_smart", nameKey: "tqc.personality.owl_smart.name", descriptionKey: "tqc.personality.owl_smart.description", emoji: "🦉" },
  { value: "owl_versatile", nameKey: "tqc.personality.owl_versatile.name", descriptionKey: "tqc.personality.owl_versatile.description", emoji: "🦉" },
  { value: "owl_genius", nameKey: "tqc.personality.owl_genius.name", descriptionKey: "tqc.personality.owl_genius.description", emoji: "🦉" },
  { value: "owl_talent", nameKey: "tqc.personality.owl_talent.name", descriptionKey: "tqc.personality.owl_talent.description", emoji: "🦉" },
  { value: "owl_reverse", nameKey: "tqc.personality.owl_reverse.name", descriptionKey: "tqc.personality.owl_reverse.description", emoji: "🦉" },
  { value: "owl_genius_brave", nameKey: "tqc.personality.owl_genius_brave.name", descriptionKey: "tqc.personality.owl_genius_brave.description", emoji: "🦉" },
  { value: "owl_genius_gentle", nameKey: "tqc.personality.owl_genius_gentle.name", descriptionKey: "tqc.personality.owl_genius_gentle.description", emoji: "🦉" },
  { value: "owl_genius_smart", nameKey: "tqc.personality.owl_genius_smart.name", descriptionKey: "tqc.personality.owl_genius_smart.description", emoji: "🦉" },
  { value: "owl_genius_versatile", nameKey: "tqc.personality.owl_genius_versatile.name", descriptionKey: "tqc.personality.owl_genius_versatile.description", emoji: "🦉" },
  { value: "owl_talent_brave", nameKey: "tqc.personality.owl_talent_brave.name", descriptionKey: "tqc.personality.owl_talent_brave.description", emoji: "🦉" },
  { value: "owl_talent_gentle", nameKey: "tqc.personality.owl_talent_gentle.name", descriptionKey: "tqc.personality.owl_talent_gentle.description", emoji: "🦉" },
  { value: "owl_talent_smart", nameKey: "tqc.personality.owl_talent_smart.name", descriptionKey: "tqc.personality.owl_talent_smart.description", emoji: "🦉" },
  { value: "owl_talent_versatile", nameKey: "tqc.personality.owl_talent_versatile.name", descriptionKey: "tqc.personality.owl_talent_versatile.description", emoji: "🦉" },
  { value: "owl_reverse_brave", nameKey: "tqc.personality.owl_reverse_brave.name", descriptionKey: "tqc.personality.owl_reverse_brave.description", emoji: "🦉" },
  { value: "owl_reverse_gentle", nameKey: "tqc.personality.owl_reverse_gentle.name", descriptionKey: "tqc.personality.owl_reverse_gentle.description", emoji: "🦉" },
  { value: "owl_reverse_smart", nameKey: "tqc.personality.owl_reverse_smart.name", descriptionKey: "tqc.personality.owl_reverse_smart.description", emoji: "🦉" },
  { value: "owl_reverse_versatile", nameKey: "tqc.personality.owl_reverse_versatile.name", descriptionKey: "tqc.personality.owl_reverse_versatile.description", emoji: "🦉" },
  { value: "dragon_brave", nameKey: "tqc.personality.dragon_brave.name", descriptionKey: "tqc.personality.dragon_brave.description", emoji: "🐉" },
  { value: "dragon_gentle", nameKey: "tqc.personality.dragon_gentle.name", descriptionKey: "tqc.personality.dragon_gentle.description", emoji: "🐉" },
  { value: "dragon_smart", nameKey: "tqc.personality.dragon_smart.name", descriptionKey: "tqc.personality.dragon_smart.description", emoji: "🐉" },
  { value: "dragon_versatile", nameKey: "tqc.personality.dragon_versatile.name", descriptionKey: "tqc.personality.dragon_versatile.description", emoji: "🐉" },
  { value: "dragon_genius", nameKey: "tqc.personality.dragon_genius.name", descriptionKey: "tqc.personality.dragon_genius.description", emoji: "🐉" },
  { value: "dragon_talent", nameKey: "tqc.personality.dragon_talent.name", descriptionKey: "tqc.personality.dragon_talent.description", emoji: "🐉" },
  { value: "dragon_reverse", nameKey: "tqc.personality.dragon_reverse.name", descriptionKey: "tqc.personality.dragon_reverse.description", emoji: "🐉" },
  { value: "dragon_genius_brave", nameKey: "tqc.personality.dragon_genius_brave.name", descriptionKey: "tqc.personality.dragon_genius_brave.description", emoji: "🐉" },
  { value: "dragon_genius_gentle", nameKey: "tqc.personality.dragon_genius_gentle.name", descriptionKey: "tqc.personality.dragon_genius_gentle.description", emoji: "🐉" },
  { value: "dragon_genius_smart", nameKey: "tqc.personality.dragon_genius_smart.name", descriptionKey: "tqc.personality.dragon_genius_smart.description", emoji: "🐉" },
  { value: "dragon_genius_versatile", nameKey: "tqc.personality.dragon_genius_versatile.name", descriptionKey: "tqc.personality.dragon_genius_versatile.description", emoji: "🐉" },
  { value: "dragon_talent_brave", nameKey: "tqc.personality.dragon_talent_brave.name", descriptionKey: "tqc.personality.dragon_talent_brave.description", emoji: "🐉" },
  { value: "dragon_talent_gentle", nameKey: "tqc.personality.dragon_talent_gentle.name", descriptionKey: "tqc.personality.dragon_talent_gentle.description", emoji: "🐉" },
  { value: "dragon_talent_smart", nameKey: "tqc.personality.dragon_talent_smart.name", descriptionKey: "tqc.personality.dragon_talent_smart.description", emoji: "🐉" },
  { value: "dragon_talent_versatile", nameKey: "tqc.personality.dragon_talent_versatile.name", descriptionKey: "tqc.personality.dragon_talent_versatile.description", emoji: "🐉" },
  { value: "dragon_reverse_brave", nameKey: "tqc.personality.dragon_reverse_brave.name", descriptionKey: "tqc.personality.dragon_reverse_brave.description", emoji: "🐉" },
  { value: "dragon_reverse_gentle", nameKey: "tqc.personality.dragon_reverse_gentle.name", descriptionKey: "tqc.personality.dragon_reverse_gentle.description", emoji: "🐉" },
  { value: "dragon_reverse_smart", nameKey: "tqc.personality.dragon_reverse_smart.name", descriptionKey: "tqc.personality.dragon_reverse_smart.description", emoji: "🐉" },
  { value: "dragon_reverse_versatile", nameKey: "tqc.personality.dragon_reverse_versatile.name", descriptionKey: "tqc.personality.dragon_reverse_versatile.description", emoji: "🐉" },
];

export const PERSONALITY_TYPE_VALUES = PERSONALITY_TYPES.map((p) => p.value) as [string, ...string[]];
