"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n";

export async function updateOwnName(fullName: string): Promise<{ ok: boolean; message: string }> {
  if (!fullName.trim()) return { ok: false, message: await t("profile.error.name_required") };

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: await t("profile.error.not_signed_in") };

  const { data: userRow } = await supabase.from("users").select("party_id").eq("auth_user_id", user.id).single();
  if (!userRow) return { ok: false, message: await t("profile.error.user_not_found") };

  // individuals has no self-UPDATE policy — this relies on every portal user
  // already being back-office (is_back_office() grants the write), which is
  // true by definition for anyone who reached this page via the layout gate.
  const { error } = await supabase.from("individuals").update({ full_name: fullName.trim() }).eq("party_id", userRow.party_id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/profile");
  return { ok: true, message: await t("profile.success.name_updated") };
}

export async function changeOwnPassword(newPassword: string): Promise<{ ok: boolean; message: string }> {
  if (newPassword.length < 8) return { ok: false, message: await t("profile.error.password_min") };

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, message: error.message };

  return { ok: true, message: await t("profile.success.password_updated") };
}
