import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface UnpostedSummary {
  unpostedOrderCount: number;
  unpostedCommissionCount: number;
}

// "Unposted" = a paid order / commission_record with no matching
// journal_entries row (keyed by source_type + source_id) — see the posting
// action in actions.ts for why this stays a manual batch operation rather
// than an automatic trigger.
export async function getUnpostedSummary(): Promise<UnpostedSummary> {
  const admin = createAdminClient();
  const [{ data: paidOrders }, { data: postedOrderEntries }, { data: commissions }, { data: postedCommissionEntries }] = await Promise.all([
    admin.from("orders").select("id").eq("status", "paid"),
    admin.from("journal_entries").select("source_id").eq("source_type", "order"),
    admin.from("commission_records").select("id"),
    admin.from("journal_entries").select("source_id").eq("source_type", "commission_record"),
  ]);
  const postedOrderIds = new Set((postedOrderEntries ?? []).map((e) => e.source_id));
  const postedCommissionIds = new Set((postedCommissionEntries ?? []).map((e) => e.source_id));
  return {
    unpostedOrderCount: (paidOrders ?? []).filter((o) => !postedOrderIds.has(o.id)).length,
    unpostedCommissionCount: (commissions ?? []).filter((c) => !postedCommissionIds.has(c.id)).length,
  };
}

export interface AccountBalance {
  code: string;
  name: string;
  balance: number;
}

export interface ProfitAndLoss {
  revenue: AccountBalance[];
  expense: AccountBalance[];
  totalRevenue: number;
  totalExpense: number;
  netProfit: number;
}

// Real P&L computed from posted journal_lines — distinct from the Admin
// Dashboard's "Monthly Sales - commission expense" estimate, which reads
// orders/commission_records directly and includes unposted transactions.
// The two will diverge until back office posts everything; that's expected
// during the transition, not a bug.
export async function getProfitAndLossThisMonth(): Promise<ProfitAndLoss> {
  const admin = createAdminClient();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const { data: accounts } = await admin
    .from("chart_of_accounts")
    .select("id, code, name, account_type")
    .in("account_type", ["revenue", "expense"]);
  const { data: entries } = await admin.from("journal_entries").select("id").gte("entry_date", monthStart);
  const entryIds = (entries ?? []).map((e) => e.id);
  const { data: lines } =
    entryIds.length > 0
      ? await admin.from("journal_lines").select("account_id, debit, credit").in("journal_entry_id", entryIds)
      : { data: [] };

  const byAccount = new Map<string, { debit: number; credit: number }>();
  for (const l of lines ?? []) {
    const cur = byAccount.get(l.account_id) ?? { debit: 0, credit: 0 };
    cur.debit += Number(l.debit);
    cur.credit += Number(l.credit);
    byAccount.set(l.account_id, cur);
  }

  const revenue: AccountBalance[] = [];
  const expense: AccountBalance[] = [];
  for (const a of accounts ?? []) {
    const totals = byAccount.get(a.id) ?? { debit: 0, credit: 0 };
    if (a.account_type === "revenue") {
      revenue.push({ code: a.code, name: a.name, balance: totals.credit - totals.debit });
    } else {
      expense.push({ code: a.code, name: a.name, balance: totals.debit - totals.credit });
    }
  }

  const totalRevenue = revenue.reduce((s, r) => s + r.balance, 0);
  const totalExpense = expense.reduce((s, e) => s + e.balance, 0);

  return { revenue, expense, totalRevenue, totalExpense, netProfit: totalRevenue - totalExpense };
}

export interface JournalEntryRow {
  id: string;
  entry_date: string;
  description: string | null;
  lines: { account_code: string; account_name: string; debit: number; credit: number }[];
}

export async function listRecentJournalEntries(limit = 20): Promise<JournalEntryRow[]> {
  const admin = createAdminClient();
  const { data: entries } = await admin
    .from("journal_entries")
    .select("id, entry_date, description")
    .order("posted_at", { ascending: false })
    .limit(limit);
  if (!entries || entries.length === 0) return [];

  const [{ data: lines }, { data: accounts }] = await Promise.all([
    admin.from("journal_lines").select("journal_entry_id, account_id, debit, credit").in("journal_entry_id", entries.map((e) => e.id)),
    admin.from("chart_of_accounts").select("id, code, name"),
  ]);
  const accountById = new Map((accounts ?? []).map((a) => [a.id, a]));

  const linesByEntry = new Map<string, JournalEntryRow["lines"]>();
  for (const l of lines ?? []) {
    const acc = accountById.get(l.account_id);
    const arr = linesByEntry.get(l.journal_entry_id) ?? [];
    arr.push({ account_code: acc?.code ?? "—", account_name: acc?.name ?? "—", debit: Number(l.debit), credit: Number(l.credit) });
    linesByEntry.set(l.journal_entry_id, arr);
  }

  return entries.map((e) => ({
    id: e.id,
    entry_date: e.entry_date,
    description: e.description,
    lines: linesByEntry.get(e.id) ?? [],
  }));
}
