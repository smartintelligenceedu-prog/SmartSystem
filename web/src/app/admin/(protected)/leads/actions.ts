"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

const VALID_STATUSES = ["new", "contacted", "converted", "lost"] as const;
type LeadStatus = (typeof VALID_STATUSES)[number];

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
  if (!user) return { error: t("leads.error.not_signed_in") };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  if (!isBackOffice) return { error: t("leads.error.no_permission") };

  const { data: userRow } = await supabase.from("users").select("id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: t("leads.error.no_permission") };

  return { userId: userRow.id };
}

// Runs through the caller's own RLS session (not the admin client) —
// leads' "for all" policy already allows the assigned analyst or back
// office to update, so there's no need to re-derive/re-check that here.
export async function updateLeadStatus(leadId: string, status: LeadStatus): Promise<{ ok: boolean; message: string }> {
  if (!VALID_STATUSES.includes(status)) return { ok: false, message: t("leads.error.invalid_status") };

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: t("leads.error.not_signed_in") };

  const { error } = await supabase.from("leads").update({ status }).eq("id", leadId);
  if (error) return { ok: false, message: `${t("leads.error.update_failed_prefix")}${error.message}` };

  revalidatePath("/admin/leads");
  return { ok: true, message: t("leads.status_updated") };
}

// Back-office-only: moves a lead to a different analyst regardless of who
// it's currently assigned to. Needed because rebinding an introducer's
// assigned_analyst_id only routes that introducer's *future* leads — it
// doesn't retroactively move leads already sitting unconverted under an
// analyst who's gone inactive, so this covers that gap directly on the
// lead itself. Uses the admin client since the RLS "for all" policy's
// with-check would reject a plain analyst-scoped session reassigning to
// someone else (see rls_policies.sql leads policies).
export async function adminReassignLead(leadId: string, analystId: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { error } = await admin.from("leads").update({ assigned_analyst_id: analystId }).eq("id", leadId);
  if (error) return { ok: false, message: `${t("leads.error.update_failed_prefix")}${error.message}` };

  revalidatePath("/admin/leads");
  return { ok: true, message: t("leads.status_updated") };
}
