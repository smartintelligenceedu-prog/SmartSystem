import zh from "../../locales/zh.json";

// Language-ready scaffolding (no switcher yet — see /locales/README or
// AGENTS.md for the convention). Every UI string in new modules should go
// through t("some.key") instead of being hardcoded, so that turning on a
// real language switcher later only means changing this function's
// internals — reading the user's chosen locale and picking en.json instead
// of zh.json — not touching every component that calls it.
type TranslationKey = keyof typeof zh;

export function t(key: TranslationKey): string {
  return zh[key];
}
