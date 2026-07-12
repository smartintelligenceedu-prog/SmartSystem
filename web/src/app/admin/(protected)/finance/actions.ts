"use server";

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

const REVENUE_ACCOUNT_CODE_BY_ORDER_TYPE: Record<string, string> = {
  registration: "4000",
  detection_service: "4100",
};

const EXPENSE_ACCOUNT_CODE_BY_TRIGGER: Record<string, string> = {
  recruitment: "5000",
  personal_sale: "5100",
  pic_channel: "5200",
  introducer: "5300",
  voucher_resale: "5400",
};

/**
 * Manual/periodic posting (the user's explicit choice over automatic
 * per-transaction posting): back office reviews the unposted count on
 * /admin/finance and calls this to post everything in one batch. Posts
 * gross for every paid order — including voucher-redemption orders, where
 * the customer paid the analyst directly and no cash reached the company
 * bank account — because the offsetting 100% commission expense nets Net
 * Profit to zero either way, and this keeps the posting logic uniform
 * rather than special-casing one order type (confirmed with the user).
 */
export async function postToLedger(): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();

  const { data: accounts } = await admin.from("chart_of_accounts").select("id, code");
  const accountIdByCode = new Map((accounts ?? []).map((a) => [a.code, a.id]));
  const cashAccountId = accountIdByCode.get("1000");
  const payableAccountId = accountIdByCode.get("2000");
  if (!cashAccountId || !payableAccountId) {
    return { ok: false, message: "找不到必要的会计科目，请先确认 Chart of Accounts 已建立" };
  }

  const [{ data: paidOrders }, { data: postedOrderEntries }, { data: commissions }, { data: postedCommissionEntries }] = await Promise.all([
    admin.from("orders").select("id, order_type, total_amount, created_at").eq("status", "paid"),
    admin.from("journal_entries").select("source_id").eq("source_type", "order"),
    admin.from("commission_records").select("id, trigger_type, commission_amount, calculated_at"),
    admin.from("journal_entries").select("source_id").eq("source_type", "commission_record"),
  ]);
  const postedOrderIds = new Set((postedOrderEntries ?? []).map((e) => e.source_id));
  const postedCommissionIds = new Set((postedCommissionEntries ?? []).map((e) => e.source_id));
  const unpostedOrders = (paidOrders ?? []).filter((o) => !postedOrderIds.has(o.id));
  const unpostedCommissions = (commissions ?? []).filter((c) => !postedCommissionIds.has(c.id));

  if (unpostedOrders.length === 0 && unpostedCommissions.length === 0) {
    return { ok: true, message: "没有需要过帐的交易" };
  }

  let postedCount = 0;

  for (const order of unpostedOrders) {
    const revenueCode = REVENUE_ACCOUNT_CODE_BY_ORDER_TYPE[order.order_type];
    const revenueAccountId = revenueCode ? accountIdByCode.get(revenueCode) : undefined;
    if (!revenueAccountId) continue;

    const { data: entry, error: entryError } = await admin
      .from("journal_entries")
      .insert({
        entry_date: order.created_at.slice(0, 10),
        source_type: "order",
        source_id: order.id,
        description: order.order_type === "registration" ? "注册费收入" : "检测服务收入",
        posted_by: auth.userId,
      })
      .select("id")
      .single();
    if (entryError || !entry) continue;

    await admin.from("journal_lines").insert([
      { journal_entry_id: entry.id, account_id: cashAccountId, debit: order.total_amount, credit: 0 },
      { journal_entry_id: entry.id, account_id: revenueAccountId, debit: 0, credit: order.total_amount },
    ]);
    postedCount++;
  }

  for (const c of unpostedCommissions) {
    const expenseCode = EXPENSE_ACCOUNT_CODE_BY_TRIGGER[c.trigger_type];
    const expenseAccountId = expenseCode ? accountIdByCode.get(expenseCode) : undefined;
    if (!expenseAccountId) continue;

    const { data: entry, error: entryError } = await admin
      .from("journal_entries")
      .insert({
        entry_date: c.calculated_at.slice(0, 10),
        source_type: "commission_record",
        source_id: c.id,
        description: `佣金支出 - ${c.trigger_type}`,
        posted_by: auth.userId,
      })
      .select("id")
      .single();
    if (entryError || !entry) continue;

    await admin.from("journal_lines").insert([
      { journal_entry_id: entry.id, account_id: expenseAccountId, debit: c.commission_amount, credit: 0 },
      { journal_entry_id: entry.id, account_id: payableAccountId, debit: 0, credit: c.commission_amount },
    ]);
    postedCount++;
  }

  revalidatePath("/admin/finance");
  return { ok: true, message: `已过帐 ${postedCount} 笔交易` };
}
