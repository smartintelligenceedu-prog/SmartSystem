"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getPortalUserContext, hasRole } from "@/lib/auth/context";
import type { PortalUserContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";

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
    return { ok: false, error: "需要管理员权限才能执行此操作" };
  }
  return { ok: true, context };
}

const createUserSchema = z.object({
  full_name: z.string().trim().min(2, "请输入姓名"),
  email: z.string().trim().email("请输入有效的电邮地址"),
  password: z.string().min(8, "密码至少需要 8 个字元"),
  roles: z.array(z.enum(["admin", "finance", "back_office"])).min(1, "至少选择一个角色"),
});

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

  const parsed = createUserSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    password: formData.get("password"),
    roles: formData.getAll("roles"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "表单资料有误" };
  }
  const input = parsed.data;

  const admin = createAdminClient();

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (authError || !authUser.user) {
    return { status: "error", message: `建立登入帐号失败：${authError?.message ?? "未知错误"}` };
  }

  const { data: party, error: partyError } = await admin.from("parties").insert({ party_type: "individual" }).select("id").single();
  if (partyError) return { status: "error", message: `建立资料失败：${partyError.message}` };

  await admin.from("individuals").insert({ party_id: party.id, full_name: input.full_name, email: input.email });

  const { data: userRow, error: userError } = await admin
    .from("users")
    .insert({ party_id: party.id, auth_user_id: authUser.user.id })
    .select("id")
    .single();
  if (userError) return { status: "error", message: `建立使用者失败：${userError.message}` };

  const { data: roleRows } = await admin.from("roles").select("id, name").in("name", input.roles);
  const userRoleInserts = (roleRows ?? []).map((r) => ({ user_id: userRow.id, role_id: r.id }));
  if (userRoleInserts.length > 0) {
    await admin.from("user_roles").insert(userRoleInserts);
  }

  revalidatePath("/admin/users");
  return { status: "success" };
}

export async function adminRemoveRole(
  userId: string,
  role: string
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.error };

  if (userId === auth.context.userId && role === "admin") {
    return { ok: false, message: "不能移除自己的管理员权限" };
  }

  const admin = createAdminClient();
  const { data: roleRow } = await admin.from("roles").select("id").eq("name", role).single();
  if (!roleRow) return { ok: false, message: "找不到这个角色" };

  const { error } = await admin.from("user_roles").delete().eq("user_id", userId).eq("role_id", roleRow.id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/users");
  return { ok: true, message: "已移除角色" };
}
