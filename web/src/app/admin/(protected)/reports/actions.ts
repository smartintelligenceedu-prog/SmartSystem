"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

export async function markReportDelivered(orderId: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireCallerContext();
  if ("error" in auth) return { ok: false, message: auth.error };
  if (!auth.isBackOffice && !auth.analystId) return { ok: false, message: "没有权限执行此操作" };

  const admin = createAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select("id, analyst_id, order_type, status, report_delivered_at")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, message: "找不到这笔订单" };
  if (order.order_type !== "detection_service" || order.status !== "paid") {
    return { ok: false, message: "只有已付款的检测服务订单可以标记报告交付" };
  }
  if (!auth.isBackOffice && order.analyst_id !== auth.analystId) {
    return { ok: false, message: "这笔订单不属于你" };
  }
  if (order.report_delivered_at) {
    return { ok: false, message: "这笔订单的报告已经标记为交付" };
  }

  const { error } = await admin.from("orders").update({ report_delivered_at: new Date().toISOString() }).eq("id", orderId);
  if (error) return { ok: false, message: `标记失败：${error.message}` };

  revalidatePath("/admin/reports");
  return { ok: true, message: "已标记报告交付" };
}
