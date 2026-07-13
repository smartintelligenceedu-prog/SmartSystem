"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ReportTier } from "./data";

async function requireCallerContext(): Promise<
  { analystId: string | null; isBackOffice: boolean } | { error: string }
> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "请先登入" };

  const { data: userRow } = await supabase.from("users").select("id, party_id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: "找不到对应的使用者资料" };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  const { data: analyst } = await supabase.from("analysts").select("id").eq("party_id", userRow.party_id).maybeSingle();

  return { analystId: analyst?.id ?? null, isBackOffice: !!isBackOffice };
}

// Delivery + tier classification is per-item (migration 015) — a
// multi-person order can have different people's reports finish at
// different times, so this operates on order_items, not orders. The single
// UPDATE below is the entire atomic unit: it fires
// calculate_report_override_commission() (RM40 override + report cost
// posting) in the same transaction, so there's no window where "delivered"
// is true but the payout/cost is missing — see commission_engine.sql.
export async function markReportDelivered(orderItemId: string, tier: ReportTier): Promise<{ ok: boolean; message: string }> {
  const auth = await requireCallerContext();
  if ("error" in auth) return { ok: false, message: auth.error };
  if (!auth.isBackOffice && !auth.analystId) return { ok: false, message: "没有权限执行此操作" };
  if (tier !== "standard" && tier !== "upgrade") return { ok: false, message: "请选择报告分类" };

  const admin = createAdminClient();

  const { data: item } = await admin
    .from("order_items")
    .select("id, order_id, item_type, analyst_id, report_delivered_at")
    .eq("id", orderItemId)
    .maybeSingle();
  if (!item) return { ok: false, message: "找不到这个报告项目" };
  if (item.item_type !== "detection_session" && item.item_type !== "voucher_redemption") {
    return { ok: false, message: "这个项目不是检测服务，无法标记报告交付" };
  }
  if (!auth.isBackOffice && item.analyst_id !== auth.analystId) {
    return { ok: false, message: "这个项目不属于你" };
  }
  if (item.report_delivered_at) {
    return { ok: false, message: "这份报告已经标记为交付" };
  }

  const { data: order } = await admin.from("orders").select("order_type, status").eq("id", item.order_id).maybeSingle();
  if (!order || order.order_type !== "detection_service" || order.status !== "paid") {
    return { ok: false, message: "只有已付款的检测服务订单可以标记报告交付" };
  }

  const { error } = await admin
    .from("order_items")
    .update({ report_delivered_at: new Date().toISOString(), report_tier: tier })
    .eq("id", orderItemId);
  if (error) return { ok: false, message: `标记失败：${error.message}` };

  revalidatePath("/admin/reports");
  return { ok: true, message: "已标记报告交付" };
}
