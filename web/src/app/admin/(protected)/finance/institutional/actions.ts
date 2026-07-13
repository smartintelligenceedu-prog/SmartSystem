"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireBackOfficeUserId(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "请先登入" };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  if (!isBackOffice) return { error: "没有权限执行此操作" };

  const { data: userRow } = await supabase.from("users").select("id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: "找不到对应的后台使用者资料" };

  return { userId: userRow.id };
}

const createOrderSchema = z.object({
  description: z.string().trim().min(2, "请输入订单描述"),
  total_amount: z.coerce.number().positive("金额必须大于 0"),
  quantity: z.coerce.number().int().positive("份数必须是大于 0 的整数"),
  analyst_id: z.string().uuid().optional().or(z.literal("")),
  institution_name: z.string().trim().min(2, "请输入机构名称"),
  ssm_number: z.string().trim().optional(),
  billing_address_line1: z.string().trim().min(2, "请输入开票地址"),
  billing_address_line2: z.string().trim().optional(),
  billing_city: z.string().trim().optional(),
  billing_state: z.string().trim().optional(),
  billing_postcode: z.string().trim().optional(),
  institution_phone: z.string().trim().optional(),
});

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
    return { status: "error", message: parsed.error.issues[0]?.message ?? "表单资料有误" };
  }
  const input = parsed.data;

  const admin = createAdminClient();

  const { data: party, error: partyError } = await admin.from("parties").insert({ party_type: "organization" }).select("id").single();
  if (partyError) return { status: "error", message: `建立机构资料失败：${partyError.message}` };

  const { error: orgError } = await admin.from("organizations").insert({
    party_id: party.id,
    legal_name: input.institution_name,
    registration_no: input.ssm_number || null,
    phone: input.institution_phone || null,
  });
  if (orgError) return { status: "error", message: `建立机构资料失败：${orgError.message}` };

  const { error: addressError } = await admin.from("addresses").insert({
    party_id: party.id,
    line1: input.billing_address_line1,
    line2: input.billing_address_line2 || null,
    city: input.billing_city || null,
    state: input.billing_state || null,
    postcode: input.billing_postcode || null,
  });
  if (addressError) return { status: "error", message: `建立开票地址失败：${addressError.message}` };

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
  if (orderError) return { status: "error", message: `建立订单失败：${orderError.message}` };

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
  if (itemError) return { status: "error", message: `建立订单项目失败：${itemError.message}` };

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
  if (!order) return { ok: false, message: "找不到这笔订单" };

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
  if (error) return { ok: false, message: `开票失败：${error.message}` };

  revalidatePath("/admin/finance/institutional");
  return { ok: true, message: "已开具发票" };
}

export async function issueFinalSettlementInvoice(orderId: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id, total_amount").eq("id", orderId).maybeSingle();
  if (!order) return { ok: false, message: "找不到这笔订单" };

  const { error } = await admin.from("invoices").insert({
    order_id: orderId,
    invoice_no: generateInvoiceNo(),
    amount: order.total_amount,
    invoice_type: "final_settlement",
    status: "issued",
  });
  if (error) return { ok: false, message: `开具结算发票失败：${error.message}` };

  revalidatePath("/admin/finance/institutional");
  return { ok: true, message: "已开具结算发票" };
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
  if (!parsedType.success) return { ok: false, message: "无效的付款类型" };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: "金额必须大于 0" };
  if (!method.trim()) return { ok: false, message: "请输入付款方式" };

  const admin = createAdminClient();
  const { error } = await admin.from("payments").insert({
    order_id: orderId,
    amount,
    method: method.trim(),
    payment_type: parsedType.data,
    reference_no: referenceNo.trim() || null,
  });
  if (error) return { ok: false, message: `登记收款失败：${error.message}` };

  revalidatePath("/admin/finance/institutional");
  return { ok: true, message: "已登记收款" };
}
