"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getPortalUserContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

// Built per-call, not a module-scope constant — see the identical note in
// customers/actions.ts's buildCustomerFormSchema.
async function buildLeadSchema() {
  return z.object({
    contact_name: z.string().trim().min(2, await t("leads.submit.error.name_required")),
    phone: z.string().trim().min(8, await t("leads.submit.error.phone_required")),
    email: z.string().trim().email(await t("leads.submit.error.invalid_email")).optional().or(z.literal("")),
  });
}

export type SubmitLeadState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

// Same end result as the public /refer/[code] flow (submitLead in
// refer/[code]/actions.ts) — a leads row with introducer_id/assigned_analyst_id
// set, which carries the same commission attribution through to
// customers.acquired_via_introducer_id once an analyst converts it — but
// reached from inside the introducer's own authenticated portal instead of
// requiring them to open their own public link. introducer_id/assigned_analyst_id
// come from the caller's own session here rather than a referral_code lookup.
export async function submitLeadFromPortal(_prev: SubmitLeadState, formData: FormData): Promise<SubmitLeadState> {
  const context = await getPortalUserContext();
  if (!context) return { status: "error", message: await t("leads.submit.error.not_signed_in") };
  if (!context.introducerId) return { status: "error", message: await t("leads.submit.error.no_permission") };

  const leadSchema = await buildLeadSchema();
  const parsed = leadSchema.safeParse({
    contact_name: formData.get("contact_name"),
    phone: formData.get("phone"),
    email: formData.get("email") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("leads.submit.error.invalid_form")) };
  }
  const input = parsed.data;

  const admin = createAdminClient();
  const { data: introducer } = await admin
    .from("introducers")
    .select("assigned_analyst_id")
    .eq("id", context.introducerId)
    .maybeSingle();
  if (!introducer?.assigned_analyst_id) {
    return { status: "error", message: await t("leads.submit.error.no_analyst_assigned") };
  }

  const { error } = await admin.from("leads").insert({
    contact_name: input.contact_name,
    phone: input.phone,
    email: input.email || null,
    source: `introducer_portal:${context.introducerId}`,
    introducer_id: context.introducerId,
    assigned_analyst_id: introducer.assigned_analyst_id,
    status: "new",
  });
  if (error) return { status: "error", message: `${await t("leads.submit.error.submit_failed_prefix")}${error.message}` };

  revalidatePath("/admin/leads");
  return { status: "success" };
}
