"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

async function requireBackOfficeUserId(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: await t("finance.error.not_signed_in") };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  if (!isBackOffice) return { error: await t("finance.error.no_permission") };

  const { data: userRow } = await supabase.from("users").select("id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: await t("finance.error.no_user_row") };

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
  report_override: "5500",
  analyst_report_fee: "5700",
};

const OPERATING_EXPENSE_CATEGORIES = ["software", "office", "other"] as const;
type OperatingExpenseCategory = (typeof OPERATING_EXPENSE_CATEGORIES)[number];
const OPERATING_EXPENSE_ACCOUNT_CODE: Record<OperatingExpenseCategory, string> = {
  software: "6000",
  office: "6100",
  other: "6900",
};

export type RecordExpenseState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

// Quick manual entry for company operating spending (software subscriptions,
// office supplies, etc.) — every journal_entries row before this was
// auto-derived from a paid order or a commission_record, so there was
// nowhere to record a plain one-off company expense. Posts straight to the
// ledger (Cash/Bank credit, chosen expense account debit) — no separate
// review/approval queue, matching the user's explicit choice.
//
// Reads from FormData via a <form action={...}> + useActionState, same
// pattern as every other Select-bearing form in this codebase (see
// create-introducer-form.tsx) — NOT manual useState + a plain onClick call,
// which the category Select was originally wired through and silently
// submitted the wrong value.
export async function recordOperatingExpense(_prev: RecordExpenseState, formData: FormData): Promise<RecordExpenseState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const category = formData.get("category");
  const description = String(formData.get("description") ?? "");
  const amount = Number(formData.get("amount"));
  const entryDate = String(formData.get("expense_date") ?? "");

  if (!OPERATING_EXPENSE_CATEGORIES.includes(category as OperatingExpenseCategory)) {
    return { status: "error", message: await t("finance.error.select_category") };
  }
  if (!description.trim()) return { status: "error", message: await t("finance.error.description_required") };
  if (!Number.isFinite(amount) || amount <= 0) return { status: "error", message: await t("finance.error.valid_amount") };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) return { status: "error", message: await t("finance.error.valid_date") };

  const admin = createAdminClient();

  const { data: accounts } = await admin.from("chart_of_accounts").select("id, code");
  const accountIdByCode = new Map((accounts ?? []).map((a) => [a.code, a.id]));
  const cashAccountId = accountIdByCode.get("1000");
  const expenseAccountId = accountIdByCode.get(OPERATING_EXPENSE_ACCOUNT_CODE[category as OperatingExpenseCategory]);
  if (!cashAccountId || !expenseAccountId) {
    return { status: "error", message: await t("finance.error.missing_accounts") };
  }

  const { data: entry, error: entryError } = await admin
    .from("journal_entries")
    .insert({
      entry_date: entryDate,
      source_type: "manual_expense",
      source_id: null,
      description: description.trim(),
      posted_by: auth.userId,
    })
    .select("id")
    .single();
  if (entryError || !entry) {
    return { status: "error", message: `${await t("finance.error.record_failed_prefix")}${entryError?.message ?? (await t("finance.error.unknown_error"))}` };
  }

  const { error: linesError } = await admin.from("journal_lines").insert([
    { journal_entry_id: entry.id, account_id: expenseAccountId, debit: amount, credit: 0 },
    { journal_entry_id: entry.id, account_id: cashAccountId, debit: 0, credit: amount },
  ]);
  if (linesError) return { status: "error", message: `${await t("finance.error.record_failed_prefix")}${linesError.message}` };

  revalidatePath("/admin/finance");
  return { status: "success" };
}

/**
 * Manual/periodic posting (the user's explicit choice over automatic
 * per-transaction posting): back office reviews the unposted count/list on
 * /admin/finance and calls this to post either everything (no `selection`
 * argument — the original bulk button) or just the checked rows (`selection`
 * — lets an unconfirmed/pending commission be left out while everything else
 * still gets posted). Posts gross for every paid order — including
 * voucher-redemption orders, where the customer paid the analyst directly
 * and no cash reached the company bank account — because the offsetting
 * 100% commission expense nets Net Profit to zero either way, and this keeps
 * the posting logic uniform rather than special-casing one order type
 * (confirmed with the user).
 */
export async function postToLedger(selection?: { orderIds: string[]; commissionIds: string[] }): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();

  const { data: accounts } = await admin.from("chart_of_accounts").select("id, code");
  const accountIdByCode = new Map((accounts ?? []).map((a) => [a.code, a.id]));
  const cashAccountId = accountIdByCode.get("1000");
  const payableAccountId = accountIdByCode.get("2000");
  if (!cashAccountId || !payableAccountId) {
    return { ok: false, message: await t("finance.error.missing_accounts") };
  }

  const [{ data: paidOrders }, { data: postedOrderEntries }, { data: commissions }, { data: postedCommissionEntries }] = await Promise.all([
    // billing_mode = 'invoice' orders (migration 016) are excluded — those
    // are institutional/B2B orders already auto-posted the moment their
    // invoice/payment is recorded (see finance_engine.sql). Posting them
    // again here would double-count their revenue.
    admin.from("orders").select("id, order_type, total_amount, created_at").eq("status", "paid").neq("billing_mode", "invoice"),
    admin.from("journal_entries").select("source_id").eq("source_type", "order"),
    admin.from("commission_records").select("id, trigger_type, commission_amount, calculated_at"),
    admin.from("journal_entries").select("source_id").eq("source_type", "commission_record"),
  ]);
  const postedOrderIds = new Set((postedOrderEntries ?? []).map((e) => e.source_id));
  const postedCommissionIds = new Set((postedCommissionEntries ?? []).map((e) => e.source_id));
  let unpostedOrders = (paidOrders ?? []).filter((o) => !postedOrderIds.has(o.id));
  let unpostedCommissions = (commissions ?? []).filter((c) => !postedCommissionIds.has(c.id));

  // Re-filter against the caller's checked rows server-side rather than
  // trusting the client list outright — a stale/tampered selection can only
  // narrow what gets posted, never post something already posted or not
  // actually unposted.
  if (selection) {
    const selectedOrderIds = new Set(selection.orderIds);
    const selectedCommissionIds = new Set(selection.commissionIds);
    unpostedOrders = unpostedOrders.filter((o) => selectedOrderIds.has(o.id));
    unpostedCommissions = unpostedCommissions.filter((c) => selectedCommissionIds.has(c.id));
  }

  if (unpostedOrders.length === 0 && unpostedCommissions.length === 0) {
    return { ok: true, message: await t("finance.success.no_transactions_to_post") };
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
        description:
          order.order_type === "registration"
            ? await t("finance.entry.registration_revenue")
            : await t("finance.entry.detection_service_revenue"),
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
        description: `${await t("finance.entry.commission_expense_prefix")}${c.trigger_type}`,
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
  return { ok: true, message: `${await t("finance.success.posted_prefix")}${postedCount}${await t("finance.success.posted_suffix")}` };
}
