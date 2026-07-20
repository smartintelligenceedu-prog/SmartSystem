"use server";

import { cookies } from "next/headers";
import { createServerSupabaseClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import { LOCALE_COOKIE, type Locale } from "./i18n-shared";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Sets the runtime `locale` cookie (works for anonymous public-page
 * visitors too), and additionally persists it to users.locale when the
 * caller is logged in — so the preference follows them across devices. The
 * `users` table has no self-UPDATE RLS policy (only back office can write
 * it directly), so this verifies the caller's own session first and then
 * writes through the admin client scoped to exactly that row, same pattern
 * as other legitimate self-service writes elsewhere in this codebase (e.g.
 * customers/actions.ts's createCustomer).
 */
export async function setLocale(locale: Locale): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
  });

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const admin = createAdminClient();
  await admin.from("users").update({ locale }).eq("auth_user_id", user.id);
}
