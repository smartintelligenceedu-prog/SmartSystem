import "server-only";
import { cookies } from "next/headers";
import zh from "../../locales/zh.json";
import en from "../../locales/en.json";
import { LOCALE_COOKIE, type TranslationKey, type Locale } from "./i18n-shared";

export type { TranslationKey, Locale };
export { LOCALE_COOKIE };

/**
 * Server-side lookup, locale-aware via the `locale` cookie (see the
 * setLocale Server Action in src/lib/locale-actions.ts and migration 039's
 * users.locale, which is what keeps the cookie in sync across devices).
 *
 * Async because Next's per-request-safe cookie access (`cookies()`) is only
 * available that way — this app runs as a long-lived Node process serving
 * concurrent users, so a plain module-level "current locale" variable would
 * leak between requests. Falls back to zh whenever the English value is
 * missing/blank, so an untranslated key never renders empty text.
 */
export async function t(key: TranslationKey): Promise<string> {
  const locale = await getServerLocale();
  if (locale === "en") {
    const value = (en as Record<string, string>)[key];
    if (value && value.trim() !== "") return value;
  }
  return zh[key];
}

export async function getServerLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const value = cookieStore.get(LOCALE_COOKIE)?.value;
  return value === "en" ? "en" : "zh";
}
