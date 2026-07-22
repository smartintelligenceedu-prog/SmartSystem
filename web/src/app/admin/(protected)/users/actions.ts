"use server";

import { z } from "zod";
import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { getPortalUserContext } from "@/lib/auth/context";
import type { PortalUserContext } from "@/lib/auth/context";
import { hasRole } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/notifications";
import { t } from "@/lib/i18n";

// base64url avoids +/= (URL/display-unsafe) — same scheme as the analyst
// login-creation/reset flow in registrations/actions.ts.
function generatePassword(): string {
  return randomBytes(9).toString("base64url");
}

/**
 * Permission: this whole file requires the 'admin' role specifically, not
 * just any back-office role — one level stricter than the is_back_office()
 * check used everywhere else in the admin section. Checked independently of
 * the page-level gate, same reasoning as every other admin Server Action.
 */
type RequireAdminResult = { ok: true; context: PortalUserContext } | { ok: false; error: string };

async function requireAdmin(): Promise<RequireAdminResult> {
  const context = await getPortalUserContext();
  if (!context || !hasRole(context, "admin")) {
    return { ok: false, error: await t("users.error.admin_required") };
  }
  return { ok: true, context };
}

async function buildCreateUserSchema() {
  return z.object({
    full_name: z.string().trim().min(2, await t("users.error.full_name_required")),
    email: z.string().trim().email(await t("users.error.invalid_email")),
    password: z.string().min(8, await t("users.error.password_min")),
    roles: z.array(z.enum(["admin", "finance", "back_office"])).min(1, await t("users.error.roles_required")),
  });
}

export type CreateUserState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

export async function adminCreateBackOfficeUser(
  _prev: CreateUserState,
  formData: FormData
): Promise<CreateUserState> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.error };

  const createUserSchema = await buildCreateUserSchema();
  const parsed = createUserSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    password: formData.get("password"),
    roles: formData.getAll("roles"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("users.error.form_invalid")) };
  }
  const input = parsed.data;

  const admin = createAdminClient();

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (authError || !authUser.user) {
    return {
      status: "error",
      message: `${await t("users.error.create_login_failed_prefix")}${authError?.message ?? (await t("users.error.unknown"))}`,
    };
  }

  const { data: party, error: partyError } = await admin.from("parties").insert({ party_type: "individual" }).select("id").single();
  if (partyError) return { status: "error", message: `${await t("users.error.create_profile_failed_prefix")}${partyError.message}` };

  await admin.from("individuals").insert({ party_id: party.id, full_name: input.full_name, email: input.email });

  const { data: userRow, error: userError } = await admin
    .from("users")
    .insert({ party_id: party.id, auth_user_id: authUser.user.id })
    .select("id")
    .single();
  if (userError) return { status: "error", message: `${await t("users.error.create_user_failed_prefix")}${userError.message}` };

  const { data: roleRows } = await admin.from("roles").select("id, name").in("name", input.roles);
  const userRoleInserts = (roleRows ?? []).map((r) => ({ user_id: userRow.id, role_id: r.id }));
  if (userRoleInserts.length > 0) {
    await admin.from("user_roles").insert(userRoleInserts);
  }

  revalidatePath("/admin/users");
  return { status: "success" };
}

export async function adminAddRole(userId: string, role: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { data: roleRow } = await admin.from("roles").select("id").eq("name", role).single();
  if (!roleRow) return { ok: false, message: await t("users.error.role_not_found") };

  const { error } = await admin.from("user_roles").insert({ user_id: userId, role_id: roleRow.id });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/users");
  return { ok: true, message: await t("users.success.role_added") };
}

export async function adminSetUserStatus(
  userId: string,
  status: "active" | "suspended"
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.error };

  if (userId === auth.context.userId && status === "suspended") {
    return { ok: false, message: await t("users.error.cannot_suspend_self") };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("users").update({ status }).eq("id", userId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/users");
  return { ok: true, message: await t("users.success.status_updated") };
}

/**
 * Generates a fresh password for a back-office account (admin/finance/back
 * office) and emails it to them — same pattern as the analyst password-reset
 * flow in registrations/actions.ts. Back office itself never sees or sets
 * the password, other than as an on-screen fallback if the email fails.
 */
export async function adminResetUserPassword(userId: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { data: userRow } = await admin.from("users").select("auth_user_id, party_id").eq("id", userId).maybeSingle();
  if (!userRow) return { ok: false, message: await t("users.error.user_not_found") };

  const { data: identity } = await admin.from("individuals").select("email, full_name").eq("party_id", userRow.party_id).maybeSingle();
  if (!identity?.email) return { ok: false, message: await t("users.error.no_email") };

  const password = generatePassword();
  const { error: authError } = await admin.auth.admin.updateUserById(userRow.auth_user_id, { password });
  if (authError) {
    return { ok: false, message: `${await t("users.error.reset_password_failed_prefix")}${authError.message}` };
  }

  await sendEmail({
    to: [identity.email],
    subject: `你的密码已重设 - ${identity.full_name}`,
    html: `<p>${identity.full_name} 你好，</p><p>你的 Smart Intelligence Edu 后台账号密码已经重设：</p><p>登入邮箱：${identity.email}<br/>新密码：<strong>${password}</strong></p><p>登入网址：https://mytqc.com.my/admin/login，登入后可在「我的帐户」页面自行更改密码。</p>`,
  });

  revalidatePath("/admin/users");
  return {
    ok: true,
    message: `${await t("users.success.password_reset")}${await t("users.reset_password.fallback_prefix")}${password}${await t("users.reset_password.fallback_suffix")}`,
  };
}

export async function adminRemoveRole(
  userId: string,
  role: string
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.error };

  if (userId === auth.context.userId && role === "admin") {
    return { ok: false, message: await t("users.error.cannot_remove_own_admin") };
  }

  const admin = createAdminClient();
  const { data: roleRow } = await admin.from("roles").select("id").eq("name", role).single();
  if (!roleRow) return { ok: false, message: await t("users.error.role_not_found") };

  const { error } = await admin.from("user_roles").delete().eq("user_id", userId).eq("role_id", roleRow.id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/users");
  return { ok: true, message: await t("users.success.role_removed") };
}
