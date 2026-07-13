"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadRegistrationDocument, validateUploadFile } from "@/lib/storage";

async function requireAnalystUserId(): Promise<{ userId: string; analystId: string } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "请先登入" };

  const { data: userRow } = await supabase.from("users").select("id, party_id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: "找不到对应的使用者资料" };

  const { data: analyst } = await supabase
    .from("analysts")
    .select("id, status")
    .eq("party_id", userRow.party_id)
    .maybeSingle();
  if (!analyst) return { error: "此帐号没有分析师身份" };
  if (analyst.status !== "approved") return { error: "此分析师帐号尚未核准，无法执行此操作" };

  return { userId: userRow.id, analystId: analyst.id };
}

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

const memberSchema = z.object({
  customer_id: z.string().uuid(),
  analyst_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
});

const redeemSchema = z.object({
  mode: z.literal("redeem_voucher"),
  customer_id: z.string().uuid("请选择顾客"),
  amount: z.coerce.number().positive("请输入正确的金额"),
  voucher_id: z.string().uuid("请选择要兑换的检测券"),
});

const payNowSchema = z.object({
  mode: z.literal("pay_now"),
  members_json: z.string().min(1, "请至少加入一位顾客"),
});

export type CreateSalesOrderState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; paid: boolean };

function parseMembers(membersJson: string): { customer_id: string; analyst_id: string; amount: number }[] | null {
  try {
    const raw = JSON.parse(membersJson);
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const parsed = raw.map((m) => memberSchema.safeParse(m));
    if (parsed.some((p) => !p.success)) return null;
    return parsed.map((p) => (p as { success: true; data: z.infer<typeof memberSchema> }).data);
  } catch {
    return null;
  }
}

export async function createSalesOrder(_prev: CreateSalesOrderState, formData: FormData): Promise<CreateSalesOrderState> {
  const auth = await requireAnalystUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const admin = createAdminClient();
  const mode = formData.get("mode");

  if (mode === "redeem_voucher") {
    const parsed = redeemSchema.safeParse({
      mode: "redeem_voucher",
      customer_id: formData.get("customer_id"),
      amount: formData.get("amount"),
      voucher_id: formData.get("voucher_id"),
    });
    if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "表单资料有误" };
    const input = parsed.data;

    const { data: customer } = await admin.from("customers").select("id, owner_analyst_id").eq("id", input.customer_id).maybeSingle();
    if (!customer || customer.owner_analyst_id !== auth.analystId) {
      return { status: "error", message: "找不到这位顾客，或此顾客不属于你" };
    }

    const { data: voucher } = await admin
      .from("detection_vouchers")
      .select("id, analyst_id, voucher_type, status")
      .eq("id", input.voucher_id)
      .maybeSingle();
    if (!voucher || voucher.analyst_id !== auth.analystId) {
      return { status: "error", message: "找不到这张检测券，或不属于你" };
    }
    if (voucher.voucher_type !== "resale" || voucher.status !== "issued") {
      return { status: "error", message: "这张检测券目前无法兑换" };
    }

    // Voucher redemption skips payment review entirely — the customer paid
    // the analyst directly for a resold voucher, so there's nothing for back
    // office to verify. Goes straight to 'paid', which fires the commission
    // trigger (100% to the redeeming analyst — see commission_engine.sql).
    // Always single-item/single-person: a resale voucher lives in one
    // specific agent's own inventory, so it can't be split across people or
    // reassigned to a different agent the way a pay-now order can.
    //
    // Must insert as 'pending' first, then order_items, THEN a separate
    // update to 'paid' — the trigger is `after insert or update of status`,
    // so inserting directly with status = 'paid' fires it before order_items
    // exists, and calculate_commissions_for_order() would see no items yet.
    // Same order-items-before-paid requirement the Registration Module's
    // approve flow already relies on (see the comment in registrations/actions.ts).
    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({ order_type: "detection_service", analyst_id: auth.analystId, total_amount: input.amount, status: "pending" })
      .select("id")
      .single();
    if (orderError) return { status: "error", message: `建立订单失败：${orderError.message}` };

    const { error: itemError } = await admin.from("order_items").insert({
      order_id: order.id,
      item_type: "voucher_redemption",
      description: "检测券兑换",
      unit_price: input.amount,
      quantity: 1,
      subtotal: input.amount,
      customer_id: input.customer_id,
      analyst_id: auth.analystId,
    });
    if (itemError) return { status: "error", message: `建立订单明细失败：${itemError.message}` };

    await admin
      .from("detection_vouchers")
      .update({ status: "redeemed", redeemed_at: new Date().toISOString() })
      .eq("id", voucher.id);

    const { error: payError } = await admin.from("orders").update({ status: "paid" }).eq("id", order.id);
    if (payError) return { status: "error", message: `更新订单状态失败：${payError.message}` };

    revalidatePath("/admin/sales-orders");
    revalidatePath("/admin");
    return { status: "success", paid: true };
  }

  // pay_now path: one payment can cover several people (e.g. a family
  // visiting together) each credited to their own agent. Order starts
  // 'pending', waits for back-office review of the one shared payment
  // screenshot — same flow as the Registration Module.
  const parsed = payNowSchema.safeParse({ mode: "pay_now", members_json: formData.get("members_json") });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "表单资料有误" };

  const members = parseMembers(parsed.data.members_json);
  if (!members) return { status: "error", message: "请至少加入一位顾客，并填妥金额" };

  const customerIds = [...new Set(members.map((m) => m.customer_id))];
  const { data: ownedCustomers } = await admin.from("customers").select("id").in("id", customerIds).eq("owner_analyst_id", auth.analystId);
  if (!ownedCustomers || ownedCustomers.length !== customerIds.length) {
    return { status: "error", message: "有顾客不属于你，请重新选择" };
  }

  const analystIds = [...new Set(members.map((m) => m.analyst_id))];
  const { data: validAgents } = await admin.from("analysts").select("id").in("id", analystIds).eq("status", "approved");
  if (!validAgents || validAgents.length !== analystIds.length) {
    return { status: "error", message: "有负责分析师无效，请重新选择" };
  }

  const screenshot = formData.get("payment_screenshot") as File | null;
  const fileError = validateUploadFile(screenshot, "缴费截图", true);
  if (fileError) return { status: "error", message: fileError };

  const totalAmount = members.reduce((sum, m) => sum + m.amount, 0);

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({ order_type: "detection_service", analyst_id: auth.analystId, total_amount: totalAmount, status: "pending" })
    .select("id")
    .single();
  if (orderError) return { status: "error", message: `建立订单失败：${orderError.message}` };

  const { error: itemError } = await admin.from("order_items").insert(
    members.map((m) => ({
      order_id: order.id,
      item_type: "detection_session",
      description: "脑波检测服务",
      unit_price: m.amount,
      quantity: 1,
      subtotal: m.amount,
      customer_id: m.customer_id,
      analyst_id: m.analyst_id,
    }))
  );
  if (itemError) return { status: "error", message: `建立订单明细失败：${itemError.message}` };

  const upload = await uploadRegistrationDocument("payment-screenshots", order.id, screenshot as File);
  if (upload.error) return { status: "error", message: `文件上传失败：${upload.error}` };

  const { error: salesOrderError } = await admin.from("sales_orders").insert({
    order_id: order.id,
    payment_screenshot_url: upload.path,
    status: "pending",
  });
  if (salesOrderError) return { status: "error", message: `建立付款审核纪录失败：${salesOrderError.message}` };

  revalidatePath("/admin/sales-orders");
  return { status: "success", paid: false };
}

export async function adminApproveSalesOrder(orderId: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();

  const { data: salesOrder } = await admin.from("sales_orders").select("id, status").eq("order_id", orderId).maybeSingle();
  if (!salesOrder) return { ok: false, message: "找不到这笔订单的付款审核纪录" };
  if (salesOrder.status !== "pending") return { ok: false, message: `此订单目前状态是「${salesOrder.status}」，不是待审核` };

  // Order matters: sales_orders flips to 'approved' first, then orders.status
  // to 'paid' — that update is what fires trg_calculate_commissions.
  await admin
    .from("sales_orders")
    .update({ status: "approved", reviewed_by: auth.userId, reviewed_at: new Date().toISOString() })
    .eq("id", salesOrder.id);

  const { error: orderError } = await admin.from("orders").update({ status: "paid" }).eq("id", orderId);
  if (orderError) return { ok: false, message: `更新订单状态失败：${orderError.message}` };

  revalidatePath("/admin/sales-orders");
  revalidatePath("/admin");
  return { ok: true, message: "已核准，佣金已计算" };
}

export async function adminRejectSalesOrder(orderId: string, reason: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };
  if (!reason.trim()) return { ok: false, message: "请填写拒绝原因" };

  const admin = createAdminClient();

  const { data: salesOrder } = await admin.from("sales_orders").select("id, status").eq("order_id", orderId).maybeSingle();
  if (!salesOrder) return { ok: false, message: "找不到这笔订单的付款审核纪录" };
  if (salesOrder.status !== "pending") return { ok: false, message: `此订单目前状态是「${salesOrder.status}」，不是待审核` };

  await admin
    .from("sales_orders")
    .update({ status: "rejected", rejection_reason: reason, reviewed_by: auth.userId, reviewed_at: new Date().toISOString() })
    .eq("id", salesOrder.id);
  await admin.from("orders").update({ status: "cancelled" }).eq("id", orderId);

  revalidatePath("/admin/sales-orders");
  return { ok: true, message: "已拒绝此订单" };
}
