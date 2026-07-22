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
  return z.object({
    description: z.string().trim().min(2, await t("finance.institutional.error.description_required")),
    total_amount: z.coerce.number().positive(await t("finance.institutional.error.amount_positive")),
    quantity: z.coerce.number().int().positive(await t("finance.institutional.error.quantity_positive")),
    analyst_id: z.string().uuid().optional().or(z.literal("")),
    institution_name: z.string().trim().min(2, await t("finance.institutional.error.institution_name_required")),
    ssm_number: z.string().trim().optional(),
    billing_address_line1: z.string().trim().min(2, await t("finance.institutional.error.billing_address_required")),
    billing_address_line2: z.string().trim().optional(),
    billing_city: z.string().trim().optional(),
    billing_state: z.string().trim().optional(),
    billing_postcode: z.string().trim().optional(),
    institution_phone: z.string().trim().optional(),
  });
}

export type CreateInstitutionalOrderState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

// Order creation itself never touches the ledger — matches Task 3's spec
// (orders.status starts 'pending', billing_mode 'invoice'; no accounting
// effect until an invoice is issued or a deposit is recorded).
//
// The institution's billing identity (legal name / SSM number / billing
// address) is captured fresh each time here rather than picked from an
// existing record — there's no institution management screen yet, this is
// deliberately the minimal version (migration 017's comment). It reuses the
// existing parties/organizations/addresses model instead of a dedicated
// "institutions" table.
export async function createInstitutionalOrder(
  _prev: CreateInstitutionalOrderState,
  formData: FormData
): Promise<CreateInstitutionalOrderState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const createOrderSchema = await buildCreateOrderSchema();
  const parsed = createOrderSchema.safeParse({
    description: formData.get("description"),
    total_amount: formData.get("total_amount"),
    quantity: formData.get("quantity") || "1",
    analyst_id: formData.get("analyst_id") || undefined,
    institution_name: formData.get("institution_name"),
    ssm_number: formData.get("ssm_number") || undefined,
    billing_address_line1: formData.get("billing_address_line1"),
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

  const admin = createAdminClient();

  const { data: party, error: partyError } = await admin.from("parties").insert({ party_type: "organization" }).select("id").single();
  if (partyError) {
    return { status: "error", message: `${await t("finance.institutional.error.create_institution_failed_prefix")}${partyError.message}` };
  }

  const { error: orgError } = await admin.from("organizations").insert({
    party_id: party.id,
    legal_name: input.institution_name,
    registration_no: input.ssm_number || null,
    phone: input.institution_phone || null,
  });
  if (orgError) {
    return { status: "error", message: `${await t("finance.institutional.error.create_institution_failed_prefix")}${orgError.message}` };
  }

  const { error: addressError } = await admin.from("addresses").insert({
    party_id: party.id,
    line1: input.billing_address_line1,
    line2: input.billing_address_line2 || null,
    city: input.billing_city || null,
    state: input.billing_state || null,
    postcode: input.billing_postcode || null,
  });
  if (addressError) {
    return { status: "error", message: `${await t("finance.institutional.error.create_billing_address_failed_prefix")}${addressError.message}` };
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      order_type: "detection_service",
      status: "pending",
      billing_mode: "invoice",
      total_amount: input.total_amount,
      institution_party_id: party.id,
    })
    .select("id")
    .single();
  if (orderError) return { status: "error", message: `${await t("finance.institutional.error.create_order_failed_prefix")}${orderError.message}` };

  // unit_price is derived for display only (invoice line items) — subtotal
  // stays the authoritative total_amount rather than unit_price * quantity,
  // so a non-evenly-divisible split (e.g. RM1000 / 3) never drifts the
  // revenue/AR amounts a cent off from what the invoice/journal entries use.
  const { error: itemError } = await admin.from("order_items").insert({
    order_id: order.id,
    item_type: "detection_session",
    description: input.description,
    unit_price: Math.round((input.total_amount / input.quantity) * 100) / 100,
    quantity: input.quantity,
    subtotal: input.total_amount,
    analyst_id: input.analyst_id || null,
  });
  if (itemError) return { status: "error", message: `${await t("finance.institutional.error.create_item_failed_prefix")}${itemError.message}` };

  revalidatePath("/admin/finance/institutional");
  return { status: "success" };
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
