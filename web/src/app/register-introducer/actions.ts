"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyBackOffice } from "@/lib/notifications";
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

  // Auto-detect the sponsor from the applicant's own customer history when
  // they didn't type a code themselves — someone becoming an introducer has
  // very often already been a customer brought in by one, and shouldn't
  // need to know/re-enter that introducer's code to keep the same lineage
  // (2-level introducer commission chain) going. Matches by phone, the same
  // "same real-world person, different DB row" convention already used for
  // the introducer commission phone-duplicate guard (migration 035) — never
  // by IC/email. Silently no-ops (never blocks the application) whenever:
  // the phone matches no customer, the matched customer wasn't themselves
  // introducer-referred, or they have no delivered report yet (i.e. they
  // registered but never actually completed a detection session) — in every
  // one of those cases this applicant just becomes a sponsor-less/"root"
  // introducer, exactly like leaving the sponsor code field blank today.
  if (!sponsorId && input.phone) {
    // customers <-> individuals have no direct foreign key (both point at
    // parties), so this is two flat queries merged in application code —
    // same convention as everywhere else in this codebase that needs a
    // customer's phone (e.g. registrations/data.ts's sponsor-name lookup).
    const { data: matchedIndividuals } = await admin.from("individuals").select("party_id").eq("phone", input.phone);
    const partyIds = (matchedIndividuals ?? []).map((i) => i.party_id);
    if (partyIds.length > 0) {
      const { data: matches } = await admin
        .from("customers")
        .select("id, acquired_via_introducer_id")
        .in("party_id", partyIds)
        .not("acquired_via_introducer_id", "is", null);
      for (const match of matches ?? []) {
        const { count } = await admin
          .from("order_items")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", match.id)
          .not("report_delivered_at", "is", null);
        if (count && count > 0) {
          sponsorId = match.acquired_via_introducer_id;
          break;
        }
      }
    }
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

  // Same convention as register/actions.ts's new-analyst notification and
  // sales-orders/actions.ts's new-order notification — this was the one
  // public application flow that never told back office anything landed.
  await notifyBackOffice(
    `新引荐人申请：${input.full_name}`,
    `<p>${input.full_name}（${input.email}，${input.phone}）刚提交了引荐人申请。</p><p>请登入后台查看：/admin/introducer-applications</p>`
  );

  return { status: "success" };
}
