"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadRegistrationDocument, validateUploadFile } from "@/lib/storage";
import type { RegistrationResult } from "@/lib/types/registration";
import { getCompanyInfo } from "@/app/admin/(protected)/settings/data";
import { t } from "@/lib/i18n";

async function buildRegistrationSchema() {
  return z.object({
    full_name: z.string().trim().min(2, await t("register.error.full_name_required")),
    nickname: z.string().trim().min(1, await t("register.error.nickname_required")),
    ic_or_passport_no: z.string().trim().min(5, await t("register.error.ic_required")),
    phone: z.string().trim().min(8, await t("register.error.phone_invalid")),
    email: z.string().trim().email(await t("register.error.email_invalid")),
    bank_name: z.string().trim().min(2, await t("register.error.bank_name_required")),
    bank_account_name: z.string().trim().min(2, await t("register.error.bank_account_name_required")),
    bank_account_no: z.string().trim().min(5, await t("register.error.bank_account_no_required")),
    sponsor_referral_code: z.string().trim().optional(),
    kit_id: z.string().uuid(await t("register.error.kit_required")),
  });
}

export type RegistrationState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; result: RegistrationResult };

export async function submitRegistration(
  _prev: RegistrationState,
  formData: FormData
): Promise<RegistrationState> {
  const registrationSchema = await buildRegistrationSchema();
  const parsed = registrationSchema.safeParse({
    full_name: formData.get("full_name"),
    nickname: formData.get("nickname"),
    ic_or_passport_no: formData.get("ic_or_passport_no"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    bank_name: formData.get("bank_name"),
    bank_account_name: formData.get("bank_account_name"),
    bank_account_no: formData.get("bank_account_no"),
    sponsor_referral_code: formData.get("sponsor_referral_code") || undefined,
    kit_id: formData.get("kit_id"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("register.error.form_invalid")) };
  }
  const input = parsed.data;

  // The checkbox only renders (and stays disabled until the link is opened)
  // when an agreement URL is configured in Settings — mirror that same
  // condition here rather than unconditionally requiring it, since a
  // bypassed/missing client-side `required`/`disabled` shouldn't block
  // registration when there's nothing configured to agree to in the first
  // place. agreement_link_opened is re-checked server-side too, not just
  // trusted from the disabled-checkbox client state.
  const companyInfo = await getCompanyInfo();
  const agreementRequired = !!companyInfo.agreementUrl;
  const linkOpened = formData.get("agreement_link_opened") === "true";
  const agreedToTerms = formData.get("agree_to_terms") === "on";
  if (agreementRequired && (!linkOpened || !agreedToTerms)) {
    return { status: "error", message: await t("register.error.agreement_required") };
  }

  // File fields are validated separately from the zod text schema — FormData
  // gives back File objects the schema above isn't shaped for.
  const icDocument = formData.get("ic_document") as File | null;
  const paymentScreenshot = formData.get("payment_screenshot") as File | null;

  const fileError =
    (await validateUploadFile(icDocument, await t("register.error.ic_document_label"), true)) ??
    (await validateUploadFile(paymentScreenshot, await t("register.error.payment_screenshot_label"), true));
  if (fileError) {
    return { status: "error", message: fileError };
  }

  const admin = createAdminClient();

  // Resolve sponsor (the Introducer) by referral code, if one was given. An
  // unknown code is a hard error rather than silently dropping the sponsor —
  // recruitment commission depends on this link existing.
  let sponsorId: string | null = null;
  let sponsorName: string | null = null;
  if (input.sponsor_referral_code) {
    const { data: sponsor, error: sponsorError } = await admin
      .from("analysts")
      .select("id, party_id")
      .eq("referral_code", input.sponsor_referral_code)
      .eq("status", "approved")
      .maybeSingle();

    if (sponsorError) {
      return { status: "error", message: `${await t("register.error.sponsor_lookup_failed_prefix")}${sponsorError.message}` };
    }
    if (!sponsor) {
      return { status: "error", message: await t("register.error.sponsor_not_found") };
    }
    sponsorId = sponsor.id;

    // analysts and individuals have no direct foreign key to each other —
    // both point at parties — so this can't be a single embedded select.
    const { data: sponsorIdentity } = await admin
      .from("individuals")
      .select("full_name")
      .eq("party_id", sponsor.party_id)
      .maybeSingle();
    sponsorName = sponsorIdentity?.full_name ?? null;
  }

  const { data: kit, error: kitError } = await admin
    .from("registration_kits")
    .select("id, name, price, is_active")
    .eq("id", input.kit_id)
    .eq("is_active", true)
    .maybeSingle();

  if (kitError) {
    return { status: "error", message: `${await t("register.error.kit_lookup_failed_prefix")}${kitError.message}` };
  }
  if (!kit) {
    return { status: "error", message: await t("register.error.kit_unavailable") };
  }

  // party + individual
  const { data: party, error: partyError } = await admin
    .from("parties")
    .insert({ party_type: "individual" })
    .select("id")
    .single();

  if (partyError) {
    return { status: "error", message: `${await t("register.error.create_profile_failed_prefix")}${partyError.message}` };
  }

  const { error: individualError } = await admin.from("individuals").insert({
    party_id: party.id,
    full_name: input.full_name,
    nickname: input.nickname,
    ic_or_passport_no: input.ic_or_passport_no,
    phone: input.phone,
    email: input.email,
  });

  if (individualError) {
    return { status: "error", message: `${await t("register.error.create_individual_failed_prefix")}${individualError.message}` };
  }

  // Uploads happen after the party exists (paths are keyed by party id) and
  // before any DB row references them, so a failed upload never leaves a
  // registration_orders row pointing at a missing file.
  const [icUpload, paymentUpload] = await Promise.all([
    uploadRegistrationDocument("ic-documents", party.id, icDocument as File),
    uploadRegistrationDocument("payment-screenshots", party.id, paymentScreenshot as File),
  ]);

  const uploadError = icUpload.error ?? paymentUpload.error;
  if (uploadError) {
    return { status: "error", message: `${await t("register.error.upload_failed_prefix")}${uploadError}` };
  }

  // financial order (registration type)
  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      order_type: "registration",
      total_amount: kit.price,
      status: "pending",
    })
    .select("id")
    .single();

  if (orderError) {
    return { status: "error", message: `${await t("register.error.create_order_failed_prefix")}${orderError.message}` };
  }

  const { error: orderItemError } = await admin.from("order_items").insert({
    order_id: order.id,
    item_type: "registration_kit",
    description: kit.name,
    unit_price: kit.price,
    quantity: 1,
    subtotal: kit.price,
  });

  if (orderItemError) {
    return { status: "error", message: `${await t("register.error.create_order_item_failed_prefix")}${orderItemError.message}` };
  }

  const { data: registrationOrder, error: regOrderError } = await admin
    .from("registration_orders")
    .insert({
      party_id: party.id,
      kit_id: kit.id,
      order_id: order.id,
      sponsor_id: sponsorId,
      ic_document_url: icUpload.path,
      payment_screenshot_url: paymentUpload.path,
      status: "pending",
      agreement_accepted_at: agreedToTerms ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (regOrderError) {
    return { status: "error", message: `${await t("register.error.create_registration_order_failed_prefix")}${regOrderError.message}` };
  }

  // The analyst row is created now, in a 'pending' state — not deferred to
  // approval. This is what lets back office browse "pending applications" as
  // a plain query over analysts.status, and lets Assigned Leader be edited
  // before approval if needed. Nothing here touches commission: that only
  // fires when an admin approves and orders.status flips to 'paid'.
  const { data: analyst, error: analystError } = await admin
    .from("analysts")
    .insert({
      party_id: party.id,
      sponsor_id: sponsorId,
      assigned_leader_id: sponsorId, // defaults to the Introducer; back office can reassign later
      registration_order_id: registrationOrder.id,
      bank_name: input.bank_name,
      bank_account_name: input.bank_account_name,
      bank_account_no: input.bank_account_no,
      status: "pending",
    })
    .select("id")
    .single();

  if (analystError) {
    return { status: "error", message: `${await t("register.error.create_analyst_failed_prefix")}${analystError.message}` };
  }

  return {
    status: "success",
    result: {
      order_id: order.id,
      registration_order_id: registrationOrder.id,
      analyst_id: analyst.id,
      kit_name: kit.name,
      price: kit.price,
      sponsor_name: sponsorName,
    },
  };
}
