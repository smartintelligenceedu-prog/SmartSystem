"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

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

const createCampaignSchema = z.object({
  name: z.string().trim().min(1, await t("pic_campaigns.error.name_required")),
  campaign_type: z.enum(["school", "institution", "roadshow", "other"]),
  pic_analyst_id: z.string().uuid(await t("pic_campaigns.error.pic_required")),
  location: z.string().trim().optional(),
  pic_report_override_amount: z.coerce.number().min(0).optional(),
  pic_analyst_report_fee_amount: z.coerce.number().min(0).optional(),
});

export type CreateCampaignState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

export async function createCampaign(_prev: CreateCampaignState, formData: FormData): Promise<CreateCampaignState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const parsed = createCampaignSchema.safeParse({
    name: formData.get("name"),
    campaign_type: formData.get("campaign_type"),
    pic_analyst_id: formData.get("pic_analyst_id"),
    location: formData.get("location") || undefined,
    pic_report_override_amount: formData.get("pic_report_override_amount") || undefined,
    pic_analyst_report_fee_amount: formData.get("pic_analyst_report_fee_amount") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? await t("pic_campaigns.error.invalid_form") };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("channel_campaigns").insert({
    name: parsed.data.name,
    campaign_type: parsed.data.campaign_type,
    pic_analyst_id: parsed.data.pic_analyst_id,
    location: parsed.data.location || null,
    pic_report_override_amount: parsed.data.pic_report_override_amount ?? null,
    pic_analyst_report_fee_amount: parsed.data.pic_analyst_report_fee_amount ?? null,
  });
  if (error) return { status: "error", message: `${await t("pic_campaigns.error.create_failed")}${error.message}` };

  revalidatePath("/admin/pic-campaigns");
  return { status: "success" };
}
