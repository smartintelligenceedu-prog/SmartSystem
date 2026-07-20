"use server";

import { z } from "zod";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Same pattern as every other admin Server Action in this codebase: re-check
 * the caller's own session independently of the (protected) layout / page
 * gates. See the note in admin/registrations/actions.ts.
 */
async function requireBackOfficeUserId(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "请先登入" };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  if (!isBackOffice) return { error: "没有权限执行此操作" };

  const { data: userRow } = await supabase.from("users").select("id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: "找不到对应的后台使用者资料" };

  return { userId: userRow.id };
}

const createIntroducerSchema = z.object({
  full_name: z.string().trim().min(2, "请输入姓名"),
  email: z.string().trim().email("请输入有效的电邮地址"),
  phone: z.string().trim().min(8, "请输入有效的电话号码"),
  bank_name: z.string().trim().optional(),
  bank_account_name: z.string().trim().optional(),
  bank_account_no: z.string().trim().optional(),
  sponsor_id: z.string().uuid().optional().or(z.literal("")),
  assigned_analyst_id: z.string().uuid().optional().or(z.literal("")),
});

export type CreateIntroducerState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

export async function adminCreateIntroducer(
  _prev: CreateIntroducerState,
  formData: FormData
): Promise<CreateIntroducerState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const parsed = createIntroducerSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    bank_name: formData.get("bank_name") || undefined,
    bank_account_name: formData.get("bank_account_name") || undefined,
    bank_account_no: formData.get("bank_account_no") || undefined,
    sponsor_id: formData.get("sponsor_id") || undefined,
    assigned_analyst_id: formData.get("assigned_analyst_id") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "表单资料有误" };
  }
  const input = parsed.data;

  const admin = createAdminClient();

  const { data: party, error: partyError } = await admin.from("parties").insert({ party_type: "individual" }).select("id").single();
  if (partyError) return { status: "error", message: `建立资料失败：${partyError.message}` };

  await admin.from("individuals").insert({
    party_id: party.id,
    full_name: input.full_name,
    email: input.email,
    phone: input.phone,
  });

  // introducers.referral_code has no DB default (unlike analysts.referral_code) — generate one here.
  const referralCode = randomUUID().replace(/-/g, "");

  const { error: introducerError } = await admin.from("introducers").insert({
    party_id: party.id,
    sponsor_id: input.sponsor_id || null,
    referral_code: referralCode,
    bank_name: input.bank_name ?? null,
    bank_account_name: input.bank_account_name ?? null,
    bank_account_no: input.bank_account_no ?? null,
    status: "active",
    assigned_analyst_id: input.assigned_analyst_id || null,
  });
  if (introducerError) return { status: "error", message: `建立引荐人失败：${introducerError.message}` };

  revalidatePath("/admin/introducers");
  return { status: "success" };
}

// Migration 038 — introducers previously had no assigned-analyst editor at
// all (only set-once at creation). This lets back office set/change it for
// existing introducers too, since the public /refer/[code] lead link needs
// it to route leads anywhere.
export async function adminUpdateIntroducerAssignedAnalyst(
  introducerId: string,
  analystId: string | null
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { error } = await admin.from("introducers").update({ assigned_analyst_id: analystId }).eq("id", introducerId);
  if (error) return { ok: false, message: `更新失败：${error.message}` };

  revalidatePath("/admin/introducers");
  return { ok: true, message: "已更新" };
}

export async function adminCreateIntroducerLogin(
  introducerId: string,
  password: string
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };
  if (password.length < 8) return { ok: false, message: "密码至少需要 8 个字元" };

  const admin = createAdminClient();

  const { data: introducer } = await admin.from("introducers").select("party_id").eq("id", introducerId).single();
  if (!introducer) return { ok: false, message: "找不到这位引荐人" };

  const { data: existingUser } = await admin.from("users").select("id").eq("party_id", introducer.party_id).maybeSingle();
  if (existingUser) return { ok: false, message: "这位引荐人已经有登入帐号了" };

  const { data: identity } = await admin.from("individuals").select("email").eq("party_id", introducer.party_id).single();
  if (!identity?.email) return { ok: false, message: "找不到这位引荐人的电邮资料" };

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: identity.email,
    password,
    email_confirm: true,
  });
  if (authError || !authUser.user) {
    return { ok: false, message: `建立登入帐号失败：${authError?.message ?? "未知错误"}` };
  }

  const { data: userRow, error: userError } = await admin
    .from("users")
    .insert({ party_id: introducer.party_id, auth_user_id: authUser.user.id })
    .select("id")
    .single();
  if (userError) return { ok: false, message: `建立使用者失败：${userError.message}` };

  const { data: role } = await admin.from("roles").select("id").eq("name", "introducer").single();
  if (role) {
    await admin.from("user_roles").insert({ user_id: userRow.id, role_id: role.id, granted_by: auth.userId });
  }

  revalidatePath("/admin/introducers");
  return { ok: true, message: "已建立登入帐号" };
}
