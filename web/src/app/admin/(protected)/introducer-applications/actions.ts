"use server";

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
  if (!user) return { error: await t("introducer_applications.error.not_signed_in") };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  if (!isBackOffice) return { error: await t("introducer_applications.error.no_permission") };

  const { data: userRow } = await supabase.from("users").select("id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: await t("introducer_applications.error.no_user_row") };

  return { userId: userRow.id };
}

// Approving turns the application into the real party/individual/introducers
// rows — same shape as adminCreateIntroducer in admin/introducers/actions.ts,
// just sourced from applicant-submitted data instead of admin-typed data.
export async function approveIntroducerApplication(applicationId: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();

  const { data: application } = await admin
    .from("introducer_applications")
    .select("id, status, full_name, email, phone, bank_name, bank_account_name, bank_account_no, sponsor_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (!application) return { ok: false, message: await t("introducer_applications.error.not_found") };
  if (application.status !== "pending") return { ok: false, message: await t("introducer_applications.error.already_processed") };

  const { data: party, error: partyError } = await admin.from("parties").insert({ party_type: "individual" }).select("id").single();
  if (partyError) return { ok: false, message: `${await t("introducer_applications.error.create_profile_failed_prefix")}${partyError.message}` };

  await admin.from("individuals").insert({
    party_id: party.id,
    full_name: application.full_name,
    email: application.email,
    phone: application.phone,
  });

  const referralCode = randomUUID().replace(/-/g, "");

  const { data: introducer, error: introducerError } = await admin
    .from("introducers")
    .insert({
      party_id: party.id,
      sponsor_id: application.sponsor_id,
      referral_code: referralCode,
      bank_name: application.bank_name,
      bank_account_name: application.bank_account_name,
      bank_account_no: application.bank_account_no,
      status: "active",
    })
    .select("id")
    .single();
  if (introducerError) {
    return { ok: false, message: `${await t("introducer_applications.error.create_introducer_failed_prefix")}${introducerError.message}` };
  }

  const { error: updateError } = await admin
    .from("introducer_applications")
    .update({
      status: "approved",
      resulting_introducer_id: introducer.id,
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", applicationId);
  if (updateError) {
    return { ok: false, message: `${await t("introducer_applications.error.update_status_failed_prefix")}${updateError.message}` };
  }

  revalidatePath("/admin/introducer-applications");
  revalidatePath("/admin/introducers");
  return { ok: true, message: await t("introducer_applications.success.approved") };
}

export async function rejectIntroducerApplication(applicationId: string, reason: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };
  if (!reason.trim()) return { ok: false, message: await t("introducer_applications.error.reason_required") };

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("introducer_applications")
    .update({
      status: "rejected",
      rejection_reason: reason.trim(),
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", applicationId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: `${await t("introducer_applications.error.reject_failed_prefix")}${error.message}` };
  if (!data) return { ok: false, message: await t("introducer_applications.error.already_processed") };

  revalidatePath("/admin/introducer-applications");
  return { ok: true, message: await t("introducer_applications.success.rejected") };
}
