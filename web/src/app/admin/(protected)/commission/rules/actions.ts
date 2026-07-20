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
  if (!user) return { error: await t("commission.rules.error.not_signed_in") };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  if (!isBackOffice) return { error: await t("commission.rules.error.no_permission") };

  const { data: userRow } = await supabase.from("users").select("id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: await t("commission.rules.error.no_user_row") };

  return { userId: userRow.id };
}

// Built per-call, not a module-scope constant — see the identical note in
// customers/actions.ts's buildCustomerFormSchema.
async function buildUpdateRuleSchema() {
  return z
    .object({
      trigger_type: z.enum(["personal_sale", "pic_channel", "introducer", "recruitment", "voucher_resale", "report_override", "analyst_report_fee"]),
      level_number: z.coerce.number().int(),
      calculation_type: z.enum(["percentage", "flat"]),
      rate_percent: z.coerce.number().min(0).max(100).optional(),
      flat_amount: z.coerce.number().min(0).optional(),
      cap_amount: z.coerce.number().min(0).optional(),
    })
    .refine((v) => (v.calculation_type === "percentage" ? v.rate_percent !== undefined : v.flat_amount !== undefined), {
      message: await t("commission.rules.error.rate_or_amount_required"),
    });
}

export type UpdateCommissionRuleState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

// Versions the rule rather than mutating it in place: closes out the
// currently-active row (effective_to = yesterday) and inserts a new one
// effective from today. get_active_rule() in commission_engine.sql picks
// whichever row's effective_from/effective_to covers "today" — this is what
// makes sure a rate change only affects commissions calculated from today
// onward, never rewriting what already-calculated commission_records show
// (those captured their own rate_applied/calculation_type at insert time).
export async function updateCommissionRule(_prev: UpdateCommissionRuleState, formData: FormData): Promise<UpdateCommissionRuleState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const updateRuleSchema = await buildUpdateRuleSchema();
  const parsed = updateRuleSchema.safeParse({
    trigger_type: formData.get("trigger_type"),
    level_number: formData.get("level_number"),
    calculation_type: formData.get("calculation_type"),
    rate_percent: formData.get("rate_percent") || undefined,
    flat_amount: formData.get("flat_amount") || undefined,
    cap_amount: formData.get("cap_amount") || undefined,
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("commission.rules.error.invalid_form")) };
  const input = parsed.data;

  const admin = createAdminClient();

  const { data: plan } = await admin.from("compensation_plans").select("id").eq("is_active", true).limit(1).single();
  if (!plan) return { status: "error", message: await t("commission.rules.error.no_active_plan") };

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: currentRules } = await admin
    .from("commission_rules")
    .select("id")
    .eq("trigger_type", input.trigger_type)
    .eq("level_number", input.level_number)
    .lte("effective_from", todayStr)
    .or(`effective_to.is.null,effective_to.gte.${todayStr}`);

  if (currentRules && currentRules.length > 0) {
    const { error: closeError } = await admin
      .from("commission_rules")
      .update({ effective_to: yesterday })
      .in(
        "id",
        currentRules.map((r) => r.id)
      );
    if (closeError) return { status: "error", message: `${await t("commission.rules.error.close_old_rule_failed_prefix")}${closeError.message}` };
  }

  const { error: insertError } = await admin.from("commission_rules").insert({
    plan_id: plan.id,
    trigger_type: input.trigger_type,
    level_number: input.level_number,
    calculation_type: input.calculation_type,
    rate_percent: input.calculation_type === "percentage" ? input.rate_percent : null,
    flat_amount: input.calculation_type === "flat" ? input.flat_amount : null,
    cap_amount: input.cap_amount ?? null,
    effective_from: todayStr,
  });
  if (insertError) return { status: "error", message: `${await t("commission.rules.error.create_rule_failed_prefix")}${insertError.message}` };

  revalidatePath("/admin/commission/rules");
  return { status: "success" };
}
