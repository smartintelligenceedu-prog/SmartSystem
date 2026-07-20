"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ReportTier } from "./data";
import { t } from "@/lib/i18n";

async function requireCallerContext(): Promise<
  { analystId: string | null; isBackOffice: boolean } | { error: string }
> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: await t("reports.error.not_signed_in") };

  const { data: userRow } = await supabase.from("users").select("id, party_id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: await t("reports.error.no_user_row") };

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
  if (!auth.isBackOffice && !auth.analystId) return { ok: false, message: await t("reports.error.no_permission") };
  if (tier !== "standard" && tier !== "upgrade") return { ok: false, message: await t("reports.error.select_tier") };

  const admin = createAdminClient();

  const { data: item } = await admin
    .from("order_items")
    .select("id, order_id, item_type, analyst_id, report_delivered_at")
    .eq("id", orderItemId)
    .maybeSingle();
  if (!item) return { ok: false, message: await t("reports.error.item_not_found") };
  if (item.item_type !== "detection_session" && item.item_type !== "voucher_redemption") {
    return { ok: false, message: await t("reports.error.not_detection_service") };
  }
  if (!auth.isBackOffice && item.analyst_id !== auth.analystId) {
    return { ok: false, message: await t("reports.error.not_your_item") };
  }
  if (item.report_delivered_at) {
    return { ok: false, message: await t("reports.error.already_delivered") };
  }

  const { data: order } = await admin.from("orders").select("order_type, status").eq("id", item.order_id).maybeSingle();
  if (!order || order.order_type !== "detection_service" || order.status !== "paid") {
    return { ok: false, message: await t("reports.error.order_not_paid") };
  }

  const { error } = await admin
    .from("order_items")
    .update({ report_delivered_at: new Date().toISOString(), report_tier: tier })
    .eq("id", orderItemId);
  if (error) return { ok: false, message: `${await t("reports.error.mark_failed_prefix")}${error.message}` };

  revalidatePath("/admin/reports");
  return { ok: true, message: await t("reports.success.marked_delivered") };
}
