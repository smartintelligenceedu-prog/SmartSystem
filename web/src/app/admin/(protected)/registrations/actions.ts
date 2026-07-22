"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/notifications";
import { t } from "@/lib/i18n";

// base64url avoids +/= (URL/display-unsafe) — 12 chars from a 9-byte source,
// well above the 8-char minimum this system otherwise enforces.
function generatePassword(): string {
  return randomBytes(9).toString("base64url");
}

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
  if (!user) return { error: await t("registrations.error.not_signed_in") };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  if (!isBackOffice) return { error: await t("registrations.error.no_permission") };

  const { data: userRow } = await supabase.from("users").select("id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: await t("registrations.error.no_user_row") };

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
    return { ok: false, message: await t("registrations.error.application_not_found") };
  }
  if (analyst.status !== "pending") {
    return {
      ok: false,
      message: `${await t("registrations.error.status_mismatch_prefix")}${analyst.status}${await t("registrations.error.status_mismatch_suffix_full")}`,
    };
  }

  const { data: regOrder, error: regOrderError } = await admin
    .from("registration_orders")
    .select("id, order_id, kit_id")
    .eq("id", analyst.registration_order_id)
    .single();
  if (regOrderError || !regOrder) return { ok: false, message: await t("registrations.error.registration_order_not_found") };

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
  if (approveError) return { ok: false, message: `${await t("registrations.error.update_analyst_status_failed_prefix")}${approveError.message}` };

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
    if (voucherError) return { ok: false, message: `${await t("registrations.error.create_vouchers_failed_prefix")}${voucherError.message}` };
  }

  await admin.from("business_card_orders").insert({
    analyst_id: analystId,
    registration_order_id: regOrder.id,
  });

  const { error: orderUpdateError } = await admin
    .from("orders")
    .update({ status: "paid" })
    .eq("id", regOrder.order_id);
  if (orderUpdateError) return { ok: false, message: `${await t("registrations.error.update_order_status_failed_prefix")}${orderUpdateError.message}` };

  revalidatePath("/admin/registrations");
  return { ok: true, message: await t("registrations.success.approved") };
}

export async function adminRejectRegistration(
  analystId: string,
  reason: string
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };
  if (!reason.trim()) return { ok: false, message: await t("registrations.error.reason_required") };

  const admin = createAdminClient();

  const { data: analyst } = await admin
    .from("analysts")
    .select("id, registration_order_id, status")
    .eq("id", analystId)
    .single();
  if (!analyst || !analyst.registration_order_id) return { ok: false, message: await t("registrations.error.application_not_found") };
  if (analyst.status !== "pending") {
    return {
      ok: false,
      message: `${await t("registrations.error.status_mismatch_prefix")}${analyst.status}${await t("registrations.error.status_mismatch_suffix_short")}`,
    };
  }

  const { data: regOrder } = await admin
    .from("registration_orders")
    .select("id, order_id")
    .eq("id", analyst.registration_order_id)
    .single();
  if (!regOrder) return { ok: false, message: await t("registrations.error.registration_order_not_found") };

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
  return { ok: true, message: await t("registrations.success.rejected") };
}

const editInfoSchema = z.object({
  full_name: z.string().trim().min(2),
  nickname: z.string().trim(),
  ic_or_passport_no: z.string().trim().min(5),
  phone: z.string().trim().min(8),
  email: z.string().trim().email(),
  bank_name: z.string().trim(),
  bank_account_name: z.string().trim(),
  bank_account_no: z.string().trim(),
});
export type EditInfoInput = z.infer<typeof editInfoSchema>;

/**
 * Lets back office correct an analyst's personal/bank info after
 * registration (e.g. a typo caught during review). If this analyst already
 * has a login, the Supabase Auth email is updated too — individuals.email
 * and the auth email would otherwise silently drift apart, breaking future
 * password-reset/notification emails sent to "whatever's in individuals".
 */
export async function adminUpdatePersonalInfo(
  analystId: string,
  input: EditInfoInput
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const parsed = editInfoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? (await t("registrations.error.form_invalid")) };
  }
  const data = parsed.data;

  const admin = createAdminClient();
  const { data: analyst } = await admin.from("analysts").select("party_id").eq("id", analystId).maybeSingle();
  if (!analyst) return { ok: false, message: await t("registrations.error.analyst_not_found") };

  const { error: indivError } = await admin
    .from("individuals")
    .update({
      full_name: data.full_name,
      nickname: data.nickname || null,
      ic_or_passport_no: data.ic_or_passport_no,
      phone: data.phone,
      email: data.email,
    })
    .eq("party_id", analyst.party_id);
  if (indivError) return { ok: false, message: indivError.message };

  const { error: analystError } = await admin
    .from("analysts")
    .update({
      bank_name: data.bank_name || null,
      bank_account_name: data.bank_account_name || null,
      bank_account_no: data.bank_account_no || null,
    })
    .eq("id", analystId);
  if (analystError) return { ok: false, message: analystError.message };

  const { data: userRow } = await admin.from("users").select("auth_user_id").eq("party_id", analyst.party_id).maybeSingle();
  if (userRow) {
    const { error: authUpdateError } = await admin.auth.admin.updateUserById(userRow.auth_user_id, {
      email: data.email,
      email_confirm: true,
    });
    if (authUpdateError) {
      return { ok: false, message: `${await t("registrations.error.update_auth_email_failed_prefix")}${authUpdateError.message}` };
    }
  }

  revalidatePath(`/admin/registrations/${analystId}`);
  return { ok: true, message: await t("registrations.success.info_updated") };
}

/**
 * Generates a fresh password for an analyst who already has a login and
 * emails it to them the same way the initial login-creation email works —
 * back office never sees or sets the password itself, other than as an
 * on-screen fallback if the email happens to fail to send.
 */
export async function adminResetAnalystPassword(analystId: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { data: analyst } = await admin.from("analysts").select("party_id").eq("id", analystId).maybeSingle();
  if (!analyst) return { ok: false, message: await t("registrations.error.analyst_not_found") };

  const { data: userRow } = await admin.from("users").select("auth_user_id").eq("party_id", analyst.party_id).maybeSingle();
  if (!userRow) return { ok: false, message: await t("registrations.error.no_login_yet") };

  const { data: identity } = await admin.from("individuals").select("email, full_name").eq("party_id", analyst.party_id).single();
  if (!identity?.email) return { ok: false, message: await t("registrations.error.no_email") };

  const password = generatePassword();
  const { error: authError } = await admin.auth.admin.updateUserById(userRow.auth_user_id, { password });
  if (authError) {
    return { ok: false, message: `${await t("registrations.error.reset_password_failed_prefix")}${authError.message}` };
  }

  await sendEmail({
    to: [identity.email],
    subject: `你的密码已重设 - ${identity.full_name}`,
    html: `<p>${identity.full_name} 你好，</p><p>你的 Smart Intelligence Edu 后台账号密码已经重设：</p><p>登入邮箱：${identity.email}<br/>新密码：<strong>${password}</strong></p><p>登入网址：https://mytqc.com.my/admin/login，登入后可在「我的帐户」页面自行更改密码。</p>`,
  });

  revalidatePath(`/admin/registrations/${analystId}`);
  return {
    ok: true,
    message: `${await t("registrations.success.password_reset")}${await t("registrations.login.password_fallback_prefix")}${password}${await t("registrations.login.password_fallback_suffix")}`,
  };
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
  return { ok: true, message: await t("registrations.success.leader_updated") };
}

export async function adminSetSuspendStatus(
  analystId: string,
  suspend: boolean
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { data: analyst } = await admin.from("analysts").select("status").eq("id", analystId).single();
  if (!analyst) return { ok: false, message: await t("registrations.error.analyst_not_found") };
  if (suspend && analyst.status !== "approved") {
    return { ok: false, message: await t("registrations.error.only_approved_can_suspend") };
  }
  if (!suspend && analyst.status !== "suspended") {
    return { ok: false, message: await t("registrations.error.not_suspended") };
  }

  const { error } = await admin
    .from("analysts")
    .update({ status: suspend ? "suspended" : "approved" })
    .eq("id", analystId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/registrations");
  return { ok: true, message: suspend ? await t("registrations.success.suspended") : await t("registrations.success.resumed") };
}

const GRANTABLE_EXTRA_ROLES = ["leader", "pic"] as const;
type GrantableExtraRole = (typeof GRANTABLE_EXTRA_ROLES)[number];

/**
 * Creates the Supabase Auth account + users row for an already-approved
 * analyst and grants 'agent' plus any selected extra roles (leader/pic).
 * The password is auto-generated and emailed to the analyst directly — back
 * office never sees or sets it, other than as an on-screen fallback if the
 * email happens to fail to send (see notifyBackOffice's best-effort note).
 */
export async function adminCreateAnalystLogin(
  analystId: string,
  extraRoles: GrantableExtraRole[]
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();

  const { data: analyst } = await admin.from("analysts").select("party_id, status").eq("id", analystId).single();
  if (!analyst) return { ok: false, message: await t("registrations.error.analyst_not_found") };
  if (analyst.status !== "approved") return { ok: false, message: await t("registrations.error.only_approved_can_create_login") };

  const { data: existingUser } = await admin.from("users").select("id").eq("party_id", analyst.party_id).maybeSingle();
  if (existingUser) return { ok: false, message: await t("registrations.error.already_has_login") };

  const { data: identity } = await admin.from("individuals").select("email, full_name").eq("party_id", analyst.party_id).single();
  if (!identity?.email) return { ok: false, message: await t("registrations.error.no_email") };

  const password = generatePassword();

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: identity.email,
    password,
    email_confirm: true,
  });
  if (authError || !authUser.user) {
    return { ok: false, message: `${await t("registrations.error.create_login_failed_prefix")}${authError?.message ?? (await t("registrations.error.unknown"))}` };
  }

  const { data: userRow, error: userError } = await admin
    .from("users")
    .insert({ party_id: analyst.party_id, auth_user_id: authUser.user.id })
    .select("id")
    .single();
  if (userError) return { ok: false, message: `${await t("registrations.error.create_user_failed_prefix")}${userError.message}` };

  const roleNames = ["agent", ...extraRoles.filter((r) => GRANTABLE_EXTRA_ROLES.includes(r))];
  const { data: roleRows } = await admin.from("roles").select("id, name").in("name", roleNames);
  const inserts = (roleRows ?? []).map((r) => ({ user_id: userRow.id, role_id: r.id, granted_by: auth.userId }));
  if (inserts.length > 0) await admin.from("user_roles").insert(inserts);

  await sendEmail({
    to: [identity.email],
    subject: `你的后台账号已开通 - ${identity.full_name}`,
    html: `<p>${identity.full_name} 你好，</p><p>你的 Smart Intelligence Edu 后台账号已经开通：</p><p>登入邮箱：${identity.email}<br/>初始密码：<strong>${password}</strong></p><p>登入网址：/admin/login，登入后可在「我的帐户」页面自行更改密码。</p>`,
  });

  revalidatePath(`/admin/registrations/${analystId}`);
  return {
    ok: true,
    message: `${await t("registrations.success.login_created")}${await t("registrations.login.password_fallback_prefix")}${password}${await t("registrations.login.password_fallback_suffix")}`,
  };
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
  if (!analyst) return { ok: false, message: await t("registrations.error.analyst_not_found") };

  const { data: userRow } = await admin.from("users").select("id").eq("party_id", analyst.party_id).maybeSingle();
  if (!userRow) return { ok: false, message: await t("registrations.error.no_login_yet") };

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
  return { ok: true, message: await t("registrations.success.roles_updated") };
}

/**
 * Minimal TRN-02 patch — there's no training-course/exam tracking system
 * yet, so certification is a single manual admin action. Setting
 * certification_passed_at fires trg_unlock_resale_voucher_on_certification
 * (certification_engine.sql / migration 021), which unlocks the analyst's
 * locked resale detection_voucher atomically — this action itself only
 * touches analysts, never detection_vouchers directly.
 */
export async function adminApproveCertification(analystId: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { data: analyst } = await admin.from("analysts").select("status, certification_passed_at").eq("id", analystId).maybeSingle();
  if (!analyst) return { ok: false, message: await t("registrations.certification.error.not_found") };
  if (analyst.status !== "approved") return { ok: false, message: await t("registrations.certification.error.not_approved") };
  if (analyst.certification_passed_at) return { ok: false, message: await t("registrations.certification.error.already_certified") };

  const { error } = await admin.from("analysts").update({ certification_passed_at: new Date().toISOString() }).eq("id", analystId);
  if (error) return { ok: false, message: `${await t("registrations.certification.error.update_failed")}${error.message}` };

  revalidatePath(`/admin/registrations/${analystId}`);
  return { ok: true, message: await t("registrations.certification.success") };
}
