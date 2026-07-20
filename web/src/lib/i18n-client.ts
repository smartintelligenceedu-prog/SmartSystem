"use client";

import zh from "../../locales/zh.json";
import en from "../../locales/en.json";
import { LOCALE_COOKIE, type TranslationKey, type Locale } from "./i18n-shared";

/**
 * Sync counterpart to src/lib/i18n.ts's `t()`, for "use client" files —
 * several build static option arrays (e.g. GENDER_OPTIONS) at module scope,
 * outside any component, where `await` isn't available. Reads the same
 * `locale` cookie directly via document.cookie, which is safe/synchronous in
 * the browser. Language switches always trigger a full page reload (see the
 * LocaleSwitcher component), so module-scope evaluation picks up the new
 * locale correctly on next load.
 */
export function getClientLocale(): Locale {
  if (typeof document === "undefined") return "zh";
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  return match && decodeURIComponent(match[1]) === "en" ? "en" : "zh";
}

export function ct(key: TranslationKey): string {
  const locale = getClientLocale();
  if (locale === "en") {
    const value = (en as Record<string, string>)[key];
    if (value && value.trim() !== "") return value;
  }
  return zh[key];
}
