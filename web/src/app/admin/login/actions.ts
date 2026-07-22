"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n-shared";
import { t } from "@/lib/i18n";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export type LoginState = { status: "idle" } | { status: "error"; message: string };

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/admin/registrations");

  if (!email || !password) {
    return { status: "error", message: await t("login.error.missing_credentials") };
  }

  const supabase = await createServerSupabaseClient();
  const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { status: "error", message: await t("login.error.invalid_credentials") };
  }

  // Sync the runtime locale cookie to this account's saved preference, so a
  // login on a new device/browser (where the cookie doesn't exist yet, or is
  // stale) picks up what they set last time in Profile. Filtered by
  // auth_user_id explicitly — RLS's "self or back office" select policy lets
  // a back-office caller see every row, and .single() would error on more
  // than one.
  const { data: userRow } = await supabase.from("users").select("locale, status").eq("auth_user_id", signInData.user.id).single();

  if (userRow?.status === "suspended") {
    await supabase.auth.signOut();
    return { status: "error", message: await t("login.error.suspended") };
  }

  if (userRow?.locale) {
    const cookieStore = await cookies();
    cookieStore.set(LOCALE_COOKIE, userRow.locale as Locale, {
      path: "/",
      maxAge: ONE_YEAR_SECONDS,
      sameSite: "lax",
    });
  }

  redirect(next);
}

export async function signOut() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
