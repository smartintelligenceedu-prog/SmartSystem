import zh from "../../locales/zh.json";

// Shared between the server-only t() (i18n.ts) and the client-safe ct()
// (i18n-client.ts) — kept in its own module with no "server-only" import so
// either side can pull in the cookie name / types without accidentally
// dragging next/headers (and the server-only guard) into a client bundle.
export type TranslationKey = keyof typeof zh;
export type Locale = "zh" | "en";

export const LOCALE_COOKIE = "locale";
