"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Every action here re-checks is_back_office() against the CALLER's own
 * session, independent of the (protected) layout's redirect. Per the Next.js
 * docs: "Server Functions are not separate routes in this chain... always
 * verify authentication and authorization inside each Server Function rather
 * than relying on Proxy alone." A layout guard is UX, not the boundary.
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

export async function adminApproveRegistration(
  analystId: string
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();

  const { data: analyst, error: analystError } = await admin
    .from("analysts")
    .select("id, registration_order_id, status")
    .eq("id", analystId)
    .single();
  if (analystError || !analyst || !analyst.registration_order_id) {
    return { ok: false, message: "找不到这笔申请" };
  }
  if (analyst.status !== "pending") {
    return { ok: false, message: `此申请目前状态是「${analyst.status}」，不是待审核，请重新整理页面` };
  }

  const { data: regOrder, error: regOrderError } = await admin
    .from("registration_orders")
    .select("id, order_id, kit_id")
    .eq("id", analyst.registration_order_id)
    .single();
  if (regOrderError || !regOrder) return { ok: false, message: "找不到对应的注册订单" };

  const { data: kit } = await admin
    .from("registration_kits")
    .select("voucher_self_use_count, voucher_resale_count")
    .eq("id", regOrder.kit_id)
    .single();

  // Order matters: analyst.status must already be 'approved' before
  // orders.status flips to 'paid' below, because that update is what fires
  // trg_calculate_commissions — see database/commission_engine.sql.
  const { error: approveError } = await admin
    .from("analysts")
    .update({ status: "approved" })
    .eq("id", analystId);
  if (approveError) return { ok: false, message: `更新分析师状态失败：${approveError.message}` };

  await admin
    .from("registration_orders")
    .update({ status: "fulfilled", reviewed_by: auth.userId, reviewed_at: new Date().toISOString() })
    .eq("id", regOrder.id);

  const voucherRows = [
    ...Array(kit?.voucher_self_use_count ?? 1).fill("self_use"),
    ...Array(kit?.voucher_resale_count ?? 1).fill("resale"),
  ].map((voucher_type) => ({
    registration_order_id: regOrder.id,
    analyst_id: analystId,
    voucher_type,
    status: voucher_type === "resale" ? "locked" : "issued",
  }));
  if (voucherRows.length > 0) {
    const { error: voucherError } = await admin.from("detection_vouchers").insert(voucherRows);
    if (voucherError) return { ok: false, message: `建立检测券失败：${voucherError.message}` };
  }

  await admin.from("business_card_orders").insert({
    analyst_id: analystId,
    registration_order_id: regOrder.id,
  });

  const { error: orderUpdateError } = await admin
    .from("orders")
    .update({ status: "paid" })
    .eq("id", regOrder.order_id);
  if (orderUpdateError) return { ok: false, message: `更新订单状态失败：${orderUpdateError.message}` };

  revalidatePath("/admin/registrations");
  return { ok: true, message: "已核准，佣金已计算，检测券与名片工单已建立" };
}

export async function adminRejectRegistration(
  analystId: string,
  reason: string
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };
  if (!reason.trim()) return { ok: false, message: "请填写拒绝原因" };

  const admin = createAdminClient();

  const { data: analyst } = await admin
    .from("analysts")
    .select("id, registration_order_id, status")
    .eq("id", analystId)
    .single();
  if (!analyst || !analyst.registration_order_id) return { ok: false, message: "找不到这笔申请" };
  if (analyst.status !== "pending") {
    return { ok: false, message: `此申请目前状态是「${analyst.status}」，不是待审核` };
  }

  const { data: regOrder } = await admin
    .from("registration_orders")
    .select("id, order_id")
    .eq("id", analyst.registration_order_id)
    .single();
  if (!regOrder) return { ok: false, message: "找不到对应的注册订单" };

  await admin.from("analysts").update({ status: "rejected" }).eq("id", analystId);
  await admin
    .from("registration_orders")
    .update({
      status: "cancelled",
      rejection_reason: reason,
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", regOrder.id);
  await admin.from("orders").update({ status: "cancelled" }).eq("id", regOrder.order_id);

  revalidatePath("/admin/registrations");
  return { ok: true, message: "已拒绝此申请" };
}

export async function adminSetAssignedLeader(
  analystId: string,
  leaderId: string | null
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { error } = await admin.from("analysts").update({ assigned_leader_id: leaderId }).eq("id", analystId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/registrations");
  return { ok: true, message: "已更新 Assigned Leader" };
}

export async function adminSetSuspendStatus(
  analystId: string,
  suspend: boolean
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { data: analyst } = await admin.from("analysts").select("status").eq("id", analystId).single();
  if (!analyst) return { ok: false, message: "找不到这位分析师" };
  if (suspend && analyst.status !== "approved") {
    return { ok: false, message: "只有已核准的分析师才能被暂停" };
  }
  if (!suspend && analyst.status !== "suspended") {
    return { ok: false, message: "此分析师目前不是暂停状态" };
  }

  const { error } = await admin
    .from("analysts")
    .update({ status: suspend ? "suspended" : "approved" })
    .eq("id", analystId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/registrations");
  return { ok: true, message: suspend ? "已暂停此分析师" : "已恢复此分析师" };
}

const GRANTABLE_EXTRA_ROLES = ["leader", "pic"] as const;
type GrantableExtraRole = (typeof GRANTABLE_EXTRA_ROLES)[number];

/**
 * Creates the Supabase Auth account + users row for an already-approved
 * analyst and grants 'agent' plus any selected extra roles (leader/pic).
 * Password is set directly by back office here — see the Phase 3 decision
 * to use admin-set initial passwords rather than email invites.
 */
export async function adminCreateAnalystLogin(
  analystId: string,
  password: string,
  extraRoles: GrantableExtraRole[]
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };
  if (password.length < 8) return { ok: false, message: "密码至少需要 8 个字元" };

  const admin = createAdminClient();

  const { data: analyst } = await admin.from("analysts").select("party_id, status").eq("id", analystId).single();
  if (!analyst) return { ok: false, message: "找不到这位分析师" };
  if (analyst.status !== "approved") return { ok: false, message: "只有已核准的分析师才能建立登入帐号" };

  const { data: existingUser } = await admin.from("users").select("id").eq("party_id", analyst.party_id).maybeSingle();
  if (existingUser) return { ok: false, message: "这位分析师已经有登入帐号了" };

  const { data: identity } = await admin.from("individuals").select("email").eq("party_id", analyst.party_id).single();
  if (!identity?.email) return { ok: false, message: "找不到这位分析师的电邮资料" };

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
    .insert({ party_id: analyst.party_id, auth_user_id: authUser.user.id })
    .select("id")
    .single();
  if (userError) return { ok: false, message: `建立使用者失败：${userError.message}` };

  const roleNames = ["agent", ...extraRoles.filter((r) => GRANTABLE_EXTRA_ROLES.includes(r))];
  const { data: roleRows } = await admin.from("roles").select("id, name").in("name", roleNames);
  const inserts = (roleRows ?? []).map((r) => ({ user_id: userRow.id, role_id: r.id, granted_by: auth.userId }));
  if (inserts.length > 0) await admin.from("user_roles").insert(inserts);

  revalidatePath(`/admin/registrations/${analystId}`);
  return { ok: true, message: "已建立登入帐号" };
}

/**
 * Toggles the leader/pic roles for an analyst who already has a login. The
 * 'agent' role is never touched here — it's granted once at login creation
 * and stays for the life of the account.
 */
export async function adminUpdateAnalystExtraRoles(
  analystId: string,
  extraRoles: GrantableExtraRole[]
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();

  const { data: analyst } = await admin.from("analysts").select("party_id").eq("id", analystId).single();
  if (!analyst) return { ok: false, message: "找不到这位分析师" };

  const { data: userRow } = await admin.from("users").select("id").eq("party_id", analyst.party_id).maybeSingle();
  if (!userRow) return { ok: false, message: "这位分析师还没有登入帐号" };

  const { data: leaderPicRoles } = await admin.from("roles").select("id, name").in("name", GRANTABLE_EXTRA_ROLES);
  const roleIdByName = new Map((leaderPicRoles ?? []).map((r) => [r.name, r.id]));

  const desired = new Set(extraRoles.filter((r) => GRANTABLE_EXTRA_ROLES.includes(r)));
  const toGrant = GRANTABLE_EXTRA_ROLES.filter((r) => desired.has(r));
  const toRevoke = GRANTABLE_EXTRA_ROLES.filter((r) => !desired.has(r));

  const grantIds = toGrant.map((r) => roleIdByName.get(r)).filter((id): id is string => !!id);
  const revokeIds = toRevoke.map((r) => roleIdByName.get(r)).filter((id): id is string => !!id);

  if (revokeIds.length > 0) {
    await admin.from("user_roles").delete().eq("user_id", userRow.id).in("role_id", revokeIds);
  }
  if (grantIds.length > 0) {
    const inserts = grantIds.map((role_id) => ({ user_id: userRow.id, role_id, granted_by: auth.userId }));
    await admin.from("user_roles").upsert(inserts, { onConflict: "user_id,role_id", ignoreDuplicates: true });
  }

  revalidatePath(`/admin/registrations/${analystId}`);
  return { ok: true, message: "已更新角色" };
}
