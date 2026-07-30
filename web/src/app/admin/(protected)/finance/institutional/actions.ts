"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";
import { getInstitutionalOrderForEdit, type InstitutionalOrderForEdit } from "./data";

async function requireBackOfficeUserId(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: await t("finance.institutional.error.not_signed_in") };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  if (!isBackOffice) return { error: await t("finance.institutional.error.no_permission") };

  const { data: userRow } = await supabase.from("users").select("id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: await t("finance.institutional.error.no_user_row") };

  return { userId: userRow.id };
}

// Built per-call, not a module-scope constant — see the identical note in
// customers/actions.ts's buildCustomerFormSchema.
async function buildCreateOrderSchema() {
  const institutionRequiredMessage = await t("finance.institutional.error.institution_name_required");
  return z
    .object({
      item_name: z.string().trim().min(2, await t("finance.institutional.error.description_required")),
      unit_price: z.coerce.number().positive(await t("finance.institutional.error.amount_positive")),
      // When set (migration 044), this batch counts against a negotiated
      // bulk package deal — its own institution_party_id is looked up
      // server-side rather than trusted from the client, and none of the
      // institution fields below are required in that case.
      institutional_package_id: z.string().uuid().optional().or(z.literal("")),
      // Either institution_party_id (an existing institution picked from
      // listInstitutionOptions()) OR the freeform name+address fields for a
      // brand-new one — never both, enforced below since Zod can't express
      // "exactly one of" declaratively.
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
    .refine(
      (v) =>
        !!v.institutional_package_id ||
        !!v.institution_party_id ||
        (v.institution_name && v.institution_name.length >= 2 && v.billing_address_line1),
      {
        message: institutionRequiredMessage,
        path: ["institution_name"],
      }
    );
}

// Shared party/organization/address creation for a formal institution
// billing identity — used both by a brand-new Institutional Order (this
// file) and a PIC channel campaign that wants to attach one (pic-campaigns/
// actions.ts, migration 043), so the same reusable institution record can
// come from either module. Self-contained (own admin client) since it's
// called from another module's Server Action, not just from this file.
export async function createInstitutionParty(input: {
  name: string;
  ssmNumber?: string | null;
  phone?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postcode?: string | null;
}): Promise<{ partyId: string } | { error: string }> {
  const admin = createAdminClient();

  const { data: party, error: partyError } = await admin.from("parties").insert({ party_type: "organization" }).select("id").single();
  if (partyError) return { error: `${await t("finance.institutional.error.create_institution_failed_prefix")}${partyError.message}` };

  const { error: orgError } = await admin.from("organizations").insert({
    party_id: party.id,
    legal_name: input.name,
    registration_no: input.ssmNumber || null,
    phone: input.phone || null,
  });
  if (orgError) return { error: `${await t("finance.institutional.error.create_institution_failed_prefix")}${orgError.message}` };

  const { error: addressError } = await admin.from("addresses").insert({
    party_id: party.id,
    line1: input.addressLine1,
    line2: input.addressLine2 || null,
    city: input.city || null,
    state: input.state || null,
    postcode: input.postcode || null,
  });
  if (addressError) return { error: `${await t("finance.institutional.error.create_billing_address_failed_prefix")}${addressError.message}` };

  return { partyId: party.id };
}

// Shared by createInstitutionalOrder() (this file) and
// createCampaign()/updateCampaignInstitution() (pic-campaigns/actions.ts) —
// picks an existing institution party, creates a new one, or (only valid
// for a PIC campaign, not an order) returns null for "no institution
// attached".
export async function resolveInstitutionPartyId(input: {
  institution_party_id?: string;
  institution_name?: string;
  ssm_number?: string;
  billing_address_line1?: string;
  billing_address_line2?: string;
  billing_city?: string;
  billing_state?: string;
  billing_postcode?: string;
  institution_phone?: string;
}): Promise<{ partyId: string | null } | { error: string }> {
  if (input.institution_party_id) return { partyId: input.institution_party_id };
  if (input.institution_name && input.billing_address_line1) {
    const created = await createInstitutionParty({
      name: input.institution_name,
      ssmNumber: input.ssm_number,
      phone: input.institution_phone,
      addressLine1: input.billing_address_line1,
      addressLine2: input.billing_address_line2,
      city: input.billing_city,
      state: input.billing_state,
      postcode: input.billing_postcode,
    });
    if ("error" in created) return { error: created.error };
    return { partyId: created.partyId };
  }
  return { partyId: null };
}

async function buildCreatePackageSchema() {
  const institutionRequiredMessage = await t("finance.institutional.error.institution_name_required");
  return z
    .object({
      name: z.string().trim().min(2, await t("finance.institutional.error.description_required")),
      total_credits: z.coerce.number().int().positive(await t("finance.institutional.error.quantity_positive")),
      unit_price: z.coerce.number().positive(await t("finance.institutional.error.amount_positive")),
      deposit_amount: z.coerce.number().min(0).optional(),
      // Migration 045 — optional fixed commission for this deal, mirroring
      // channel_campaigns' pic_report_override_amount /
      // pic_analyst_report_fee_amount. Both independently optional — a
      // package can pay just one, both, or neither.
      responsible_analyst_id: z.string().uuid().optional().or(z.literal("")),
      report_override_amount: z.coerce.number().min(0).optional(),
      analyst_report_fee_amount: z.coerce.number().min(0).optional(),
      // Migration 048 — flat commission paid to responsible_analyst_id when
      // the deposit payment is actually recorded (see recordPayment below),
      // not at creation time.
      deposit_commission_amount: z.coerce.number().min(0).optional(),
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

export type CreatePackageState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

// A negotiated bulk deal (migration 044) — see the header comment on that
// migration for why this is a separate model from institutional_vouchers.
// When a deposit_amount is given, migration 046 gives it a real accounting
// artifact: a "shell" order (same institution, item_type 'other' so it never
// counts as a detection-session credit, institutional_package_id left null so
// it never pollutes this package's used_credits sum) linked back via
// deposit_for_package_id. It starts in the ordinary 'no_invoice' state on the
// institutional orders list above, so back office records the deposit
// through the exact same "登记定金" flow used for every other order —
// deposit_received_at is only stamped once that actually happens (see
// recordPayment below), not here at creation time.
export async function createInstitutionalPackage(_prev: CreatePackageState, formData: FormData): Promise<CreatePackageState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const schema = await buildCreatePackageSchema();
  const parsed = schema.safeParse({
    name: formData.get("name"),
    total_credits: formData.get("total_credits"),
    unit_price: formData.get("unit_price"),
    deposit_amount: formData.get("deposit_amount") || undefined,
    responsible_analyst_id: formData.get("responsible_analyst_id") || undefined,
    report_override_amount: formData.get("report_override_amount") || undefined,
    analyst_report_fee_amount: formData.get("analyst_report_fee_amount") || undefined,
    deposit_commission_amount: formData.get("deposit_commission_amount") || undefined,
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
    return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("finance.institutional.error.invalid_form")) };
  }
  const input = parsed.data;

  const resolved = await resolveInstitutionPartyId(input);
  if ("error" in resolved) return { status: "error", message: resolved.error };
  if (!resolved.partyId) return { status: "error", message: await t("finance.institutional.error.institution_name_required") };

  const admin = createAdminClient();
  const { data: pkg, error } = await admin
    .from("institutional_packages")
    .insert({
      institution_party_id: resolved.partyId,
      name: input.name,
      total_credits: input.total_credits,
      unit_price: input.unit_price,
      deposit_amount: input.deposit_amount ?? null,
      deposit_received_at: null,
      responsible_analyst_id: input.responsible_analyst_id || null,
      report_override_amount: input.report_override_amount ?? null,
      analyst_report_fee_amount: input.analyst_report_fee_amount ?? null,
      deposit_commission_amount: input.deposit_commission_amount ?? null,
    })
    .select("id")
    .single();
  if (error) return { status: "error", message: `${await t("finance.institutional.error.create_order_failed_prefix")}${error.message}` };

  if (input.deposit_amount) {
    const { data: depositOrder, error: depositOrderError } = await admin
      .from("orders")
      .insert({
        order_type: "detection_service",
        status: "pending",
        billing_mode: "invoice",
        total_amount: input.deposit_amount,
        institution_party_id: resolved.partyId,
        deposit_for_package_id: pkg.id,
      })
      .select("id")
      .single();
    if (depositOrderError) {
      return { status: "error", message: `${await t("finance.institutional.error.create_order_failed_prefix")}${depositOrderError.message}` };
    }

    const { error: depositItemError } = await admin.from("order_items").insert({
      order_id: depositOrder.id,
      item_type: "other",
      description: `${await t("finance.institutional.package.deposit_item_prefix")}${input.name}`,
      unit_price: input.deposit_amount,
      quantity: 1,
      subtotal: input.deposit_amount,
      analyst_id: input.responsible_analyst_id || null,
    });
    if (depositItemError) {
      return { status: "error", message: `${await t("finance.institutional.error.create_item_failed_prefix")}${depositItemError.message}` };
    }
  }

  revalidatePath("/admin/finance/institutional");
  return { status: "success" };
}

export type UpdatePackageCommissionState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

// Deliberately scoped to just the deal's commission terms — total_credits,
// unit_price, and deposit_amount are foundational figures set once at
// creation; if those are wrong the package itself should be recreated
// instead. This lets back office set/adjust the responsible analyst and any
// of the three flat commission amounts on an EXISTING package (e.g. filling
// in deposit_commission_amount for a package created before migration 048
// added it).
export async function updateInstitutionalPackageCommission(
  packageId: string,
  _prev: UpdatePackageCommissionState,
  formData: FormData
): Promise<UpdatePackageCommissionState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const admin = createAdminClient();
  const { data: pkg } = await admin.from("institutional_packages").select("id").eq("id", packageId).maybeSingle();
  if (!pkg) return { status: "error", message: await t("finance.institutional.error.order_not_found") };

  const schema = z.object({
    responsible_analyst_id: z.string().uuid().optional().or(z.literal("")),
    report_override_amount: z.coerce.number().min(0).optional(),
    analyst_report_fee_amount: z.coerce.number().min(0).optional(),
    deposit_commission_amount: z.coerce.number().min(0).optional(),
  });
  const parsed = schema.safeParse({
    responsible_analyst_id: formData.get("responsible_analyst_id") || undefined,
    report_override_amount: formData.get("report_override_amount") || undefined,
    analyst_report_fee_amount: formData.get("analyst_report_fee_amount") || undefined,
    deposit_commission_amount: formData.get("deposit_commission_amount") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("finance.institutional.error.invalid_form")) };
  }
  const input = parsed.data;

  const { error } = await admin
    .from("institutional_packages")
    .update({
      responsible_analyst_id: input.responsible_analyst_id || null,
      report_override_amount: input.report_override_amount ?? null,
      analyst_report_fee_amount: input.analyst_report_fee_amount ?? null,
      deposit_commission_amount: input.deposit_commission_amount ?? null,
    })
    .eq("id", packageId);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/admin/finance/institutional");
  return { status: "success" };
}

export type CreateInstitutionalOrderState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

// Order creation itself never touches the ledger — matches Task 3's spec
// (orders.status starts 'pending', billing_mode 'invoice'; no accounting
// effect until an invoice is issued or a deposit is recorded).
//
// The institution's billing identity (legal name / SSM number / billing
// address) is either picked from an existing party (institution_party_id,
// migration 043 — reused from a prior order or PIC campaign) or captured
// fresh via createInstitutionParty(). Either way it reuses the existing
// parties/organizations/addresses model instead of a dedicated
// "institutions" table.
//
// One order can cover several test-takers under the same item/price (e.g.
// "Ditoso 150 Package" billed once per child) — the printed invoice needs
// each one on its own line with the child's name so the institution can
// cross-check names against what they paid for, matching the external
// invoice format the business already uses. student_name (formData.getAll,
// repeated inputs, same convention as the schedule/sales-order multi-row
// forms) is one entry per row, blank allowed for a row with no individual
// name — every row shares item_name/unit_price, becoming its own order_item
// with description "{item_name} ( {student_name} )" (or just item_name when
// the row has no name).
export async function createInstitutionalOrder(
  _prev: CreateInstitutionalOrderState,
  formData: FormData
): Promise<CreateInstitutionalOrderState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const createOrderSchema = await buildCreateOrderSchema();
  const parsed = createOrderSchema.safeParse({
    item_name: formData.get("item_name"),
    unit_price: formData.get("unit_price"),
    institutional_package_id: formData.get("institutional_package_id") || undefined,
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
    return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("finance.institutional.error.invalid_form")) };
  }
  const input = parsed.data;

  // Paired by DOM order — each row in the form renders its name input and
  // analyst hidden input together, so the two getAll() arrays line up 1:1
  // index-wise (same convention the schedule/sales-order multi-row forms
  // rely on for their own paired arrays).
  const studentNames = formData.getAll("student_name").map((v) => v.toString().trim());
  const studentAnalystIds = formData.getAll("student_analyst_id").map((v) => v.toString().trim());
  if (studentNames.length === 0) {
    return { status: "error", message: await t("finance.institutional.error.at_least_one_item") };
  }

  const admin = createAdminClient();

  // When a package is chosen, its own institution is authoritative — never
  // trust a client-submitted institution_party_id/institution_name for this
  // batch, since the package itself already fixes which institution it is.
  let institutionPartyId: string;
  if (input.institutional_package_id) {
    const { data: pkg } = await admin
      .from("institutional_packages")
      .select("institution_party_id")
      .eq("id", input.institutional_package_id)
      .maybeSingle();
    if (!pkg) return { status: "error", message: await t("finance.institutional.error.institution_name_required") };
    institutionPartyId = pkg.institution_party_id;
  } else {
    const resolved = await resolveInstitutionPartyId(input);
    if ("error" in resolved) return { status: "error", message: resolved.error };
    if (!resolved.partyId) return { status: "error", message: await t("finance.institutional.error.institution_name_required") };
    institutionPartyId = resolved.partyId;
  }

  const totalAmount = Math.round(input.unit_price * studentNames.length * 100) / 100;
  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      order_type: "detection_service",
      status: "pending",
      billing_mode: "invoice",
      total_amount: totalAmount,
      institution_party_id: institutionPartyId,
      institutional_package_id: input.institutional_package_id || null,
    })
    .select("id")
    .single();
  if (orderError) return { status: "error", message: `${await t("finance.institutional.error.create_order_failed_prefix")}${orderError.message}` };

  const { error: itemError } = await admin.from("order_items").insert(
    studentNames.map((name, i) => ({
      order_id: order.id,
      item_type: "detection_session",
      description: name ? `${input.item_name} ( ${name} )` : input.item_name,
      unit_price: input.unit_price,
      quantity: 1,
      subtotal: input.unit_price,
      analyst_id: studentAnalystIds[i] || null,
    }))
  );
  if (itemError) return { status: "error", message: `${await t("finance.institutional.error.create_item_failed_prefix")}${itemError.message}` };

  revalidatePath("/admin/finance/institutional");
  return { status: "success" };
}

// Migration 047 — shared by updateInstitutionalOrder and
// deleteInstitutionalOrder. Migration 045's package-commission trigger fires
// on order_item INSERT regardless of invoice status, so a wrongly-created
// order under a package with commission configured may already have
// commission_records pointing at its items (source_transaction_type =
// 'order_item', not a real FK). Refuses if any of those were already paid
// out in a payroll run (payout_run_id set) rather than silently orphaning a
// paid record; otherwise deletes the not-yet-paid ones along with the items,
// so re-inserting corrected items (edit) or leaving them gone (delete) never
// leaves stale commission behind.
async function deleteOrderItemsSafely(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: items } = await admin.from("order_items").select("id").eq("order_id", orderId);
  const itemIds = (items ?? []).map((i) => i.id);
  if (itemIds.length === 0) return { ok: true };

  const { data: paidCommissions } = await admin
    .from("commission_records")
    .select("id")
    .eq("source_transaction_type", "order_item")
    .in("source_transaction_id", itemIds)
    .not("payout_run_id", "is", null);
  if (paidCommissions && paidCommissions.length > 0) {
    return { ok: false, message: await t("finance.institutional.error.commission_already_paid") };
  }

  await admin.from("commission_records").delete().eq("source_transaction_type", "order_item").in("source_transaction_id", itemIds);
  await admin.from("order_items").delete().eq("order_id", orderId);
  return { ok: true };
}

// An order is editable/deletable only while it has no ACTIVE invoice and no
// payment at all — either it was never invoiced, or a previously-issued
// invoice was voided (voidInvoice below). Shared guard for both actions.
async function assertOrderIsEditable(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: activeInvoice } = await admin.from("invoices").select("id").eq("order_id", orderId).neq("status", "void").limit(1);
  if (activeInvoice && activeInvoice.length > 0) return { ok: false, message: await t("finance.institutional.error.order_not_editable") };
  const { data: anyPayment } = await admin.from("payments").select("id").eq("order_id", orderId).limit(1);
  if (anyPayment && anyPayment.length > 0) return { ok: false, message: await t("finance.institutional.error.order_not_editable") };
  return { ok: true };
}

async function buildEditOrderSchema() {
  return z.object({
    item_name: z.string().trim().min(2, await t("finance.institutional.error.description_required")),
    unit_price: z.coerce.number().positive(await t("finance.institutional.error.amount_positive")),
  });
}

// Thin back-office-gated wrapper so the edit form (a client component) can
// prefill from data.ts's server-only reader without exposing it directly.
export async function fetchInstitutionalOrderForEdit(orderId: string): Promise<InstitutionalOrderForEdit | null> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return null;
  return getInstitutionalOrderForEdit(orderId);
}

export type EditInstitutionalOrderState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

// Deliberately does not allow changing institution_party_id or
// institutional_package_id — a wrong institution/package on the order means
// it should be deleted and recreated instead (deleteInstitutionalOrder), not
// edited, since re-pointing an existing order at a different package would
// need the credit-usage/commission implications re-reasoned from scratch.
export async function updateInstitutionalOrder(
  orderId: string,
  _prev: EditInstitutionalOrderState,
  formData: FormData
): Promise<EditInstitutionalOrderState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const admin = createAdminClient();

  const { data: order } = await admin.from("orders").select("id").eq("id", orderId).maybeSingle();
  if (!order) return { status: "error", message: await t("finance.institutional.error.order_not_found") };

  const editable = await assertOrderIsEditable(admin, orderId);
  if (!editable.ok) return { status: "error", message: editable.message };

  const schema = await buildEditOrderSchema();
  const parsed = schema.safeParse({ item_name: formData.get("item_name"), unit_price: formData.get("unit_price") });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("finance.institutional.error.invalid_form")) };
  }
  const input = parsed.data;

  const studentNames = formData.getAll("student_name").map((v) => v.toString().trim());
  const studentAnalystIds = formData.getAll("student_analyst_id").map((v) => v.toString().trim());
  if (studentNames.length === 0) return { status: "error", message: await t("finance.institutional.error.at_least_one_item") };

  const deleted = await deleteOrderItemsSafely(admin, orderId);
  if (!deleted.ok) return { status: "error", message: deleted.message };

  const totalAmount = Math.round(input.unit_price * studentNames.length * 100) / 100;
  const { error: itemError } = await admin.from("order_items").insert(
    studentNames.map((name, i) => ({
      order_id: orderId,
      item_type: "detection_session",
      description: name ? `${input.item_name} ( ${name} )` : input.item_name,
      unit_price: input.unit_price,
      quantity: 1,
      subtotal: input.unit_price,
      analyst_id: studentAnalystIds[i] || null,
    }))
  );
  if (itemError) return { status: "error", message: `${await t("finance.institutional.error.create_item_failed_prefix")}${itemError.message}` };

  const { error: orderUpdateError } = await admin.from("orders").update({ total_amount: totalAmount }).eq("id", orderId);
  if (orderUpdateError) return { status: "error", message: `${await t("finance.institutional.error.create_order_failed_prefix")}${orderUpdateError.message}` };

  revalidatePath("/admin/finance/institutional");
  return { status: "success" };
}

// Deposit shell orders (migration 046, deposit_for_package_id set) don't fit
// updateInstitutionalOrder's item_name/student-rows shape — they're a single
// 'other'-type line whose only meaningful editable field is the amount. No
// commission-safety check is needed here (unlike deleteOrderItemsSafely):
// package_deposit_commission only fires when the deposit PAYMENT is recorded
// (migration 048), never at order/item creation, so there's nothing to have
// been paid out yet at this stage. Keeps institutional_packages.deposit_amount
// in sync so the packages table never shows a stale figure.
export async function updateDepositOrderAmount(
  orderId: string,
  _prev: EditInstitutionalOrderState,
  formData: FormData
): Promise<EditInstitutionalOrderState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const admin = createAdminClient();

  const { data: order } = await admin.from("orders").select("id, deposit_for_package_id").eq("id", orderId).maybeSingle();
  if (!order) return { status: "error", message: await t("finance.institutional.error.order_not_found") };
  if (!order.deposit_for_package_id) return { status: "error", message: await t("finance.institutional.error.order_not_found") };

  const editable = await assertOrderIsEditable(admin, orderId);
  if (!editable.ok) return { status: "error", message: editable.message };

  const amount = z.coerce.number().positive(await t("finance.institutional.error.amount_positive")).safeParse(formData.get("amount"));
  if (!amount.success) {
    return { status: "error", message: amount.error.issues[0]?.message ?? (await t("finance.institutional.error.invalid_form")) };
  }

  const { error: itemError } = await admin
    .from("order_items")
    .update({ unit_price: amount.data, subtotal: amount.data })
    .eq("order_id", orderId);
  if (itemError) return { status: "error", message: `${await t("finance.institutional.error.create_item_failed_prefix")}${itemError.message}` };

  const { error: orderError } = await admin.from("orders").update({ total_amount: amount.data }).eq("id", orderId);
  if (orderError) return { status: "error", message: `${await t("finance.institutional.error.create_order_failed_prefix")}${orderError.message}` };

  const { error: pkgError } = await admin
    .from("institutional_packages")
    .update({ deposit_amount: amount.data })
    .eq("id", order.deposit_for_package_id);
  if (pkgError) return { status: "error", message: pkgError.message };

  revalidatePath("/admin/finance/institutional");
  return { status: "success" };
}

// Only allowed when the order has NEVER had any invoice at all (not even a
// voided one) — a voided invoice's order_id linkage must survive (its
// invoice_no is kept as a record per the void-invoice design), so once an
// order has been invoiced even once, it can only be edited, never deleted.
export async function deleteInstitutionalOrder(orderId: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();

  const { data: order } = await admin.from("orders").select("id").eq("id", orderId).maybeSingle();
  if (!order) return { ok: false, message: await t("finance.institutional.error.order_not_found") };

  const { data: anyInvoiceEver } = await admin.from("invoices").select("id").eq("order_id", orderId).limit(1);
  if (anyInvoiceEver && anyInvoiceEver.length > 0) return { ok: false, message: await t("finance.institutional.error.order_not_deletable") };
  const { data: anyPayment } = await admin.from("payments").select("id").eq("order_id", orderId).limit(1);
  if (anyPayment && anyPayment.length > 0) return { ok: false, message: await t("finance.institutional.error.order_not_deletable") };

  const deleted = await deleteOrderItemsSafely(admin, orderId);
  if (!deleted.ok) return { ok: false, message: deleted.message };

  const { error } = await admin.from("orders").delete().eq("id", orderId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/finance/institutional");
  return { ok: true, message: await t("finance.institutional.success.order_deleted") };
}

function generateInvoiceNo() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `INV-${stamp}-${rand}`;
}

export async function issueInvoice(orderId: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id, total_amount, billing_mode").eq("id", orderId).maybeSingle();
  if (!order) return { ok: false, message: await t("finance.institutional.error.order_not_found") };

  // Business validation (duplicate invoice, deposit conflict, order status)
  // is re-checked inside handle_invoice_issued() — this INSERT is the only
  // statement, so a rejection there rolls back cleanly with no side effects.
  const { error } = await admin.from("invoices").insert({
    order_id: orderId,
    invoice_no: generateInvoiceNo(),
    amount: order.total_amount,
    invoice_type: "standard",
    status: "issued",
  });
  if (error) return { ok: false, message: `${await t("finance.institutional.error.issue_invoice_failed_prefix")}${error.message}` };

  revalidatePath("/admin/finance/institutional");
  return { ok: true, message: await t("finance.institutional.success.invoice_issued") };
}

export async function issueFinalSettlementInvoice(orderId: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id, total_amount").eq("id", orderId).maybeSingle();
  if (!order) return { ok: false, message: await t("finance.institutional.error.order_not_found") };

  const { error } = await admin.from("invoices").insert({
    order_id: orderId,
    invoice_no: generateInvoiceNo(),
    amount: order.total_amount,
    invoice_type: "final_settlement",
    status: "issued",
  });
  if (error) return { ok: false, message: `${await t("finance.institutional.error.issue_settlement_failed_prefix")}${error.message}` };

  revalidatePath("/admin/finance/institutional");
  return { ok: true, message: await t("finance.institutional.success.settlement_issued") };
}

// Migration 047 — lets back office fix a wrongly-issued standard invoice
// (wrong item/price/name caught after issuing, before any payment came in)
// without leaving the order stuck: void keeps the invoice row and its
// invoice_no as a record (status='void', never deleted) rather than erasing
// it, then handle_invoice_issued()'s duplicate check (patched by this same
// migration) lets a corrected invoice be issued afterward. Deliberately
// scoped to standard invoices with zero payments recorded — a
// final_settlement invoice implies a deposit already happened, which is a
// deliberately out-of-scope case (touches the ledger, not just this table).
export async function voidInvoice(orderId: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();

  const { data: anyPayment } = await admin.from("payments").select("id").eq("order_id", orderId).limit(1);
  if (anyPayment && anyPayment.length > 0) return { ok: false, message: await t("finance.institutional.error.invoice_not_voidable") };

  const { data: invoice } = await admin
    .from("invoices")
    .select("id")
    .eq("order_id", orderId)
    .eq("invoice_type", "standard")
    .eq("status", "issued")
    .maybeSingle();
  if (!invoice) return { ok: false, message: await t("finance.institutional.error.invoice_not_voidable") };

  const { error } = await admin.from("invoices").update({ status: "void" }).eq("id", invoice.id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/finance/institutional");
  return { ok: true, message: await t("finance.institutional.success.invoice_voided") };
}

// Migration 049 — nets a package's already-received deposit against this
// batch order's invoice via the apply_package_deposit_to_order() RPC, which
// posts the correct (non-cash-duplicating) journal entries itself; this
// action is just an auth-gated wrapper. See that function's header comment
// for why this can't just be a second payments.payment_type='deposit' row.
export async function applyPackageDeposit(orderId: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { error } = await admin.rpc("apply_package_deposit_to_order", { p_order_id: orderId });
  if (error) return { ok: false, message: `${await t("finance.institutional.error.apply_deposit_failed_prefix")}${error.message}` };

  revalidatePath("/admin/finance/institutional");
  return { ok: true, message: await t("finance.institutional.success.deposit_applied") };
}

// Migration 050 — undoes a wrongly-recorded deposit payment (e.g. a
// double-click that recorded the same deposit two or three times) via the
// void_deposit_payment() RPC, which posts the exact reversing journal entry
// and marks the payment 'voided' (kept, not deleted). Deliberately scoped to
// payment_type='deposit' — see that function's header comment for why.
export async function voidDepositPayment(paymentId: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { error } = await admin.rpc("void_deposit_payment", { p_payment_id: paymentId });
  if (error) return { ok: false, message: `${await t("finance.institutional.error.void_payment_failed_prefix")}${error.message}` };

  revalidatePath("/admin/finance/institutional");
  return { ok: true, message: await t("finance.institutional.success.payment_voided") };
}

const paymentTypeSchema = z.enum(["deposit", "full_payment", "final_payment"]);

export async function recordPayment(
  orderId: string,
  amount: number,
  method: string,
  paymentType: string,
  referenceNo: string
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const parsedType = paymentTypeSchema.safeParse(paymentType);
  if (!parsedType.success) return { ok: false, message: await t("finance.institutional.error.invalid_payment_type") };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: await t("finance.institutional.error.amount_positive") };
  if (!method.trim()) return { ok: false, message: await t("finance.institutional.error.payment_method_required") };

  const admin = createAdminClient();
  const { error } = await admin.from("payments").insert({
    order_id: orderId,
    amount,
    method: method.trim(),
    payment_type: parsedType.data,
    reference_no: referenceNo.trim() || null,
  });
  if (error) return { ok: false, message: `${await t("finance.institutional.error.record_payment_failed_prefix")}${error.message}` };

  // Migration 046 — this order may be a package's "shell" deposit order
  // (deposit_for_package_id set); once its deposit is actually recorded here,
  // stamp the package as received so the packages table reflects reality.
  if (parsedType.data === "deposit") {
    const { data: order } = await admin.from("orders").select("deposit_for_package_id").eq("id", orderId).maybeSingle();
    if (order?.deposit_for_package_id) {
      await admin.from("institutional_packages").update({ deposit_received_at: new Date().toISOString() }).eq("id", order.deposit_for_package_id);
    }
  }

  revalidatePath("/admin/finance/institutional");
  return { ok: true, message: await t("finance.institutional.success.payment_recorded") };
}

// Agent self-service: an agent can never issue an invoice or record a
// payment themselves (see requireBackOfficeUserId() above) — this is the one
// action they DO have, and it only stamps a timestamp so back office sees a
// "requested" flag on their own list. No invoice/payment side effect at all.
export async function requestInvoice(orderId: string): Promise<{ ok: boolean; message: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: await t("finance.institutional.error.not_signed_in") };

  const { data: userRow } = await supabase.from("users").select("id, party_id").eq("auth_user_id", user.id).single();
  if (!userRow) return { ok: false, message: await t("finance.institutional.error.no_user_row") };

  const admin = createAdminClient();

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  if (!isBackOffice) {
    const { data: analyst } = await admin.from("analysts").select("id").eq("party_id", userRow.party_id).maybeSingle();
    const { data: item } = await admin.from("order_items").select("analyst_id").eq("order_id", orderId).maybeSingle();
    if (!analyst || !item || item.analyst_id !== analyst.id) {
      return { ok: false, message: await t("finance.institutional.error.not_your_order") };
    }
  }

  const { data: order } = await admin.from("orders").select("invoice_requested_at").eq("id", orderId).maybeSingle();
  if (!order) return { ok: false, message: await t("finance.institutional.error.order_not_found") };
  if (order.invoice_requested_at) return { ok: false, message: await t("finance.institutional.error.already_requested") };

  const { error } = await admin.from("orders").update({ invoice_requested_at: new Date().toISOString() }).eq("id", orderId);
  if (error) return { ok: false, message: `${await t("finance.institutional.error.request_failed_prefix")}${error.message}` };

  revalidatePath("/admin/finance/institutional");
  return { ok: true, message: await t("finance.institutional.success.invoice_requested") };
}
