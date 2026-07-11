"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function updateOwnName(fullName: string): Promise<{ ok: boolean; message: string }> {
  if (!fullName.trim()) return { ok: false, message: "姓名不能空白" };

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "请先登入" };

  const { data: userRow } = await supabase.from("users").select("party_id").eq("auth_user_id", user.id).single();
  if (!userRow) return { ok: false, message: "找不到使用者资料" };

  // individuals has no self-UPDATE policy — this relies on every portal user
  // already being back-office (is_back_office() grants the write), which is
  // true by definition for anyone who reached this page via the layout gate.
  const { error } = await supabase.from("individuals").update({ full_name: fullName.trim() }).eq("party_id", userRow.party_id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/profile");
  return { ok: true, message: "已更新姓名" };
}

export async function changeOwnPassword(newPassword: string): Promise<{ ok: boolean; message: string }> {
  if (newPassword.length < 8) return { ok: false, message: "密码至少需要 8 个字元" };

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, message: error.message };

  return { ok: true, message: "密码已更新" };
}
