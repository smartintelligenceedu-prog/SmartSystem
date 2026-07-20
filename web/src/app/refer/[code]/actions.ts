"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

// Built per-call, not a module-scope constant — see the identical note in
// customers/actions.ts's buildCustomerFormSchema.
async function buildLeadSchema() {
  return z.object({
    code: z.string().trim().min(1),
    contact_name: z.string().trim().min(2, await t("refer.form.error_name_required")),
    phone: z.string().trim().min(8, await t("refer.form.error_phone_required")),
  });
}

export type SubmitLeadState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

// Public, unauthenticated — anyone with an introducer's /refer/[code] link
// can reach this. Deliberately minimal (name + phone only, no full customer
// registration): this creates a `leads` row for the introducer's assigned
// analyst to follow up on, not a real customers row — that conversion is a
// separate, analyst-initiated step (see customers/new/page.tsx's ?lead_id=
// handling), same posture as every other "first contact, verify later"
// intake in this app.
export async function submitLead(_prev: SubmitLeadState, formData: FormData): Promise<SubmitLeadState> {
  const leadSchema = await buildLeadSchema();
  const parsed = leadSchema.safeParse({
    code: formData.get("code"),
    contact_name: formData.get("contact_name"),
    phone: formData.get("phone"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("register.error.form_invalid")) };
  }
  const input = parsed.data;

  const admin = createAdminClient();
  const { data: introducer } = await admin
    .from("introducers")
    .select("id, assigned_analyst_id")
    .eq("referral_code", input.code)
    .eq("status", "active")
    .maybeSingle();
  if (!introducer) {
    return { status: "error", message: await t("refer.form.error_invalid_link") };
  }

  const { error } = await admin.from("leads").insert({
    contact_name: input.contact_name,
    phone: input.phone,
    source: `introducer:${input.code}`,
    introducer_id: introducer.id,
    assigned_analyst_id: introducer.assigned_analyst_id,
    status: "new",
  });
  if (error) return { status: "error", message: `${await t("refer.form.error_submit_failed_prefix")}${error.message}` };

  return { status: "success" };
}
