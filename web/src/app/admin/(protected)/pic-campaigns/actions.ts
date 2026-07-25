"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";
import { resolveInstitutionPartyId } from "../finance/institutional/actions";

async function requireBackOfficeUserId(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: await t("pic_campaigns.error.not_logged_in") };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  if (!isBackOffice) return { error: await t("pic_campaigns.error.no_permission") };

  const { data: userRow } = await supabase.from("users").select("id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: await t("pic_campaigns.error.no_user_row") };

  return { userId: userRow.id };
}

// Built inside the action (not at module scope) — t() awaits cookies() from
// next/headers, which only works inside an active request; a top-level
// `await t(...)` runs during module evaluation instead and throws every time
// this module is loaded to dispatch a Server Action here.
async function buildCreateCampaignSchema() {
  return z.object({
    name: z.string().trim().min(1, await t("pic_campaigns.error.name_required")),
    campaign_type: z.enum(["school", "institution", "roadshow", "other"]),
    pic_analyst_id: z.string().uuid(await t("pic_campaigns.error.pic_required")),
    location: z.string().trim().optional(),
    pic_report_override_amount: z.coerce.number().min(0).optional(),
    pic_analyst_report_fee_amount: z.coerce.number().min(0).optional(),
    // Optional formal billing identity (migration 043) — a campaign isn't
    // always tied to an invoiceable institution (e.g. a public mall
    // roadshow), so unlike Institutional Orders none of this is required.
    // Either institution_party_id (an existing one) or the freeform
    // name+address for a new one; both left empty just means "no formal
    // institution attached", not a validation error.
    institution_party_id: z.string().uuid().optional().or(z.literal("")),
    institution_name: z.string().trim().optional(),
    ssm_number: z.string().trim().optional(),
    billing_address_line1: z.string().trim().optional(),
    billing_address_line2: z.string().trim().optional(),
    billing_city: z.string().trim().optional(),
    billing_state: z.string().trim().optional(),
    billing_postcode: z.string().trim().optional(),
    institution_phone: z.string().trim().optional(),
  });
}

export type CreateCampaignState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

export async function createCampaign(_prev: CreateCampaignState, formData: FormData): Promise<CreateCampaignState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const createCampaignSchema = await buildCreateCampaignSchema();
  const parsed = createCampaignSchema.safeParse({
    name: formData.get("name"),
    campaign_type: formData.get("campaign_type"),
    pic_analyst_id: formData.get("pic_analyst_id"),
    location: formData.get("location") || undefined,
    pic_report_override_amount: formData.get("pic_report_override_amount") || undefined,
    pic_analyst_report_fee_amount: formData.get("pic_analyst_report_fee_amount") || undefined,
    institution_party_id: formData.get("institution_party_id") || undefined,
    institution_name: formData.get("institution_name") || undefined,
    ssm_number: formData.get("ssm_number") || undefined,
    billing_address_line1: formData.get("billing_address_line1") || undefined,
    billing_address_line2: formData.get("billing_address_line2") || undefined,
    billing_city: formData.get("billing_city") || undefined,
    billing_state: formData.get("billing_state") || undefined,
    billing_postcode: formData.get("billing_postcode") || undefined,
    institution_phone: formData.get("institution_phone") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? await t("pic_campaigns.error.invalid_form") };
  }
  const input = parsed.data;

  const resolved = await resolveInstitutionPartyId(input);
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const admin = createAdminClient();
  const { error } = await admin.from("channel_campaigns").insert({
    name: parsed.data.name,
    campaign_type: parsed.data.campaign_type,
    pic_analyst_id: parsed.data.pic_analyst_id,
    location: parsed.data.location || null,
    pic_report_override_amount: parsed.data.pic_report_override_amount ?? null,
    pic_analyst_report_fee_amount: parsed.data.pic_analyst_report_fee_amount ?? null,
    institution_party_id: resolved.partyId,
  });
  if (error) return { status: "error", message: `${await t("pic_campaigns.error.create_failed")}${error.message}` };

  revalidatePath("/admin/pic-campaigns");
  return { status: "success" };
}

async function buildUpdateInstitutionSchema() {
  const institutionRequiredMessage = await t("finance.institutional.error.institution_name_required");
  return z
    .object({
      campaign_id: z.string().uuid(),
      institution_party_id: z.string().uuid().optional().or(z.literal("")),
      institution_name: z.string().trim().optional(),
      ssm_number: z.string().trim().optional(),
      billing_address_line1: z.string().trim().optional(),
      billing_address_line2: z.string().trim().optional(),
      billing_city: z.string().trim().optional(),
      billing_state: z.string().trim().optional(),
      billing_postcode: z.string().trim().optional(),
      institution_phone: z.string().trim().optional(),
    })
    .refine((v) => !!v.institution_party_id || (v.institution_name && v.institution_name.length >= 2 && v.billing_address_line1), {
      message: institutionRequiredMessage,
      path: ["institution_name"],
    });
}

export type UpdateCampaignInstitutionState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

// Lets back office attach a formal billing identity to a campaign AFTER
// creation — a campaign created with the institution section left on "none"
// (the default) otherwise has no way to be linked later short of
// recreating it from scratch.
export async function updateCampaignInstitution(
  _prev: UpdateCampaignInstitutionState,
  formData: FormData
): Promise<UpdateCampaignInstitutionState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const schema = await buildUpdateInstitutionSchema();
  const parsed = schema.safeParse({
    campaign_id: formData.get("campaign_id"),
    institution_party_id: formData.get("institution_party_id") || undefined,
    institution_name: formData.get("institution_name") || undefined,
    ssm_number: formData.get("ssm_number") || undefined,
    billing_address_line1: formData.get("billing_address_line1") || undefined,
    billing_address_line2: formData.get("billing_address_line2") || undefined,
    billing_city: formData.get("billing_city") || undefined,
    billing_state: formData.get("billing_state") || undefined,
    billing_postcode: formData.get("billing_postcode") || undefined,
    institution_phone: formData.get("institution_phone") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("pic_campaigns.error.invalid_form")) };
  }
  const input = parsed.data;

  const resolved = await resolveInstitutionPartyId(input);
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const admin = createAdminClient();
  const { error } = await admin.from("channel_campaigns").update({ institution_party_id: resolved.partyId }).eq("id", input.campaign_id);
  if (error) return { status: "error", message: `${await t("pic_campaigns.error.create_failed")}${error.message}` };

  revalidatePath("/admin/pic-campaigns");
  return { status: "success" };
}
