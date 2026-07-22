"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

async function buildApplicationSchema() {
  return z.object({
    full_name: z.string().trim().min(2, await t("register_introducer.error.full_name_required")),
    email: z.string().trim().email(await t("register_introducer.error.email_invalid")),
    phone: z.string().trim().min(8, await t("register_introducer.error.phone_invalid")),
    bank_name: z.string().trim().optional(),
    bank_account_name: z.string().trim().optional(),
    bank_account_no: z.string().trim().optional(),
    sponsor_referral_code: z.string().trim().optional(),
    analyst_referral_code: z.string().trim().optional(),
  });
}

export type IntroducerApplicationState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

export async function submitIntroducerApplication(
  _prev: IntroducerApplicationState,
  formData: FormData
): Promise<IntroducerApplicationState> {
  const applicationSchema = await buildApplicationSchema();
  const parsed = applicationSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    bank_name: formData.get("bank_name") || undefined,
    bank_account_name: formData.get("bank_account_name") || undefined,
    bank_account_no: formData.get("bank_account_no") || undefined,
    sponsor_referral_code: formData.get("sponsor_referral_code") || undefined,
    analyst_referral_code: formData.get("analyst_referral_code") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("register_introducer.error.form_invalid")) };
  }
  const input = parsed.data;

  const admin = createAdminClient();

  // Same hard-error-on-unknown-code posture as register/actions.ts — an
  // introducer's 2-level commission chain depends on this link being real.
  let sponsorId: string | null = null;
  if (input.sponsor_referral_code) {
    const { data: sponsor, error: sponsorError } = await admin
      .from("introducers")
      .select("id")
      .eq("referral_code", input.sponsor_referral_code)
      .eq("status", "active")
      .maybeSingle();
    if (sponsorError) {
      return { status: "error", message: `${await t("register_introducer.error.sponsor_lookup_failed_prefix")}${sponsorError.message}` };
    }
    if (!sponsor) {
      return { status: "error", message: await t("register_introducer.error.sponsor_not_found") };
    }
    sponsorId = sponsor.id;
  }

  // Carries an analyst's own /register-introducer?ref=<code> link through to
  // introducers.assigned_analyst_id at approval time, so this application
  // shows up under that analyst's own Finance/leads views once approved. This
  // comes from a hidden field the applicant never sees or edits, so — unlike
  // sponsor_referral_code above — an unresolvable code is silently dropped
  // rather than blocking the whole application on a broken/stale link.
  let referringAnalystId: string | null = null;
  if (input.analyst_referral_code) {
    const { data: referringAnalyst } = await admin
      .from("analysts")
      .select("id")
      .eq("referral_code", input.analyst_referral_code)
      .eq("status", "approved")
      .maybeSingle();
    referringAnalystId = referringAnalyst?.id ?? null;
  }

  const { error } = await admin.from("introducer_applications").insert({
    full_name: input.full_name,
    email: input.email,
    phone: input.phone,
    bank_name: input.bank_name ?? null,
    bank_account_name: input.bank_account_name ?? null,
    bank_account_no: input.bank_account_no ?? null,
    sponsor_referral_code: input.sponsor_referral_code ?? null,
    sponsor_id: sponsorId,
    referring_analyst_id: referringAnalystId,
    status: "pending",
  });
  if (error) {
    return { status: "error", message: `${await t("register_introducer.error.submit_failed_prefix")}${error.message}` };
  }

  return { status: "success" };
}
