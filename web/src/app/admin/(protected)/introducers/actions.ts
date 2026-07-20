"use server";

import { z } from "zod";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

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
  if (!user) return { error: await t("introducers.error.not_signed_in") };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  if (!isBackOffice) return { error: await t("introducers.error.no_permission") };

  const { data: userRow } = await supabase.from("users").select("id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: await t("introducers.error.no_user_row") };

  return { userId: userRow.id };
}

// Built per-call, not a module-scope constant — see the identical note in
// customers/actions.ts's buildCustomerFormSchema.
async function buildCreateIntroducerSchema() {
  return z.object({
    full_name: z.string().trim().min(2, await t("introducers.error.name_required")),
    email: z.string().trim().email(await t("introducers.error.invalid_email")),
    phone: z.string().trim().min(8, await t("introducers.error.invalid_phone")),
    bank_name: z.string().trim().optional(),
    bank_account_name: z.string().trim().optional(),
    bank_account_no: z.string().trim().optional(),
    sponsor_id: z.string().uuid().optional().or(z.literal("")),
    assigned_analyst_id: z.string().uuid().optional().or(z.literal("")),
  });
}

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

  const createIntroducerSchema = await buildCreateIntroducerSchema();
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
    return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("introducers.error.invalid_form")) };
  }
  const input = parsed.data;

  const admin = createAdminClient();

  const { data: party, error: partyError } = await admin.from("parties").insert({ party_type: "individual" }).select("id").single();
  if (partyError) return { status: "error", message: `${await t("introducers.error.create_profile_failed_prefix")}${partyError.message}` };

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
  if (introducerError) {
    return { status: "error", message: `${await t("introducers.error.create_introducer_failed_prefix")}${introducerError.message}` };
  }

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
  if (error) return { ok: false, message: `${await t("introducers.error.update_failed_prefix")}${error.message}` };

  revalidatePath("/admin/introducers");
  return { ok: true, message: await t("introducers.success.updated") };
}

export async function adminCreateIntroducerLogin(
  introducerId: string,
  password: string
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };
  if (password.length < 8) return { ok: false, message: await t("introducers.error.password_min_length") };

  const admin = createAdminClient();

  const { data: introducer } = await admin.from("introducers").select("party_id").eq("id", introducerId).single();
  if (!introducer) return { ok: false, message: await t("introducers.error.introducer_not_found") };

  const { data: existingUser } = await admin.from("users").select("id").eq("party_id", introducer.party_id).maybeSingle();
  if (existingUser) return { ok: false, message: await t("introducers.error.already_has_login") };

  const { data: identity } = await admin.from("individuals").select("email").eq("party_id", introducer.party_id).single();
  if (!identity?.email) return { ok: false, message: await t("introducers.error.no_email") };

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: identity.email,
    password,
    email_confirm: true,
  });
  if (authError || !authUser.user) {
    return {
      ok: false,
      message: `${await t("introducers.error.create_login_failed_prefix")}${authError?.message ?? (await t("introducers.error.unknown_error"))}`,
    };
  }

  const { data: userRow, error: userError } = await admin
    .from("users")
    .insert({ party_id: introducer.party_id, auth_user_id: authUser.user.id })
    .select("id")
    .single();
  if (userError) return { ok: false, message: `${await t("introducers.error.create_user_failed_prefix")}${userError.message}` };

  const { data: role } = await admin.from("roles").select("id").eq("name", "introducer").single();
  if (role) {
    await admin.from("user_roles").insert({ user_id: userRow.id, role_id: role.id, granted_by: auth.userId });
  }

  revalidatePath("/admin/introducers");
  return { ok: true, message: await t("introducers.success.login_created") };
}
