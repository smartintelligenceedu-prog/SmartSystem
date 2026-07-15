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

const ORDER_TYPE_LABEL: Record<string, string> = {
  registration: "分析师注册费",
  detection_service: "检测服务收入",
};

const TRIGGER_TYPE_LABEL: Record<string, string> = {
  personal_sale: "个人销售",
  pic_channel: "通路销售（PIC）",
  introducer: "引荐人佣金",
  recruitment: "招募佣金",
  voucher_resale: "兑换券转售",
  report_override: "报告上线抽成",
  analyst_report_fee: "分析师解读费",
};

export interface UnpostedTransactionRow {
  type: "order" | "commission";
  id: string;
  date: string;
  description: string;
  subject: string;
  amount: number;
  pending: boolean;
}

// The itemized version of getUnpostedSummary()'s two counts — lets back
// office see exactly what a "过帐" click is about to record before pressing
// the (still bulk-only) button, rather than just trusting an aggregate
// number.
export async function listUnpostedTransactions(): Promise<UnpostedTransactionRow[]> {
  const admin = createAdminClient();

  const [{ data: paidOrders }, { data: postedOrderEntries }, { data: commissions }, { data: postedCommissionEntries }] = await Promise.all([
    admin.from("orders").select("id, order_type, total_amount, created_at").eq("status", "paid").neq("billing_mode", "invoice"),
    admin.from("journal_entries").select("source_id").eq("source_type", "order"),
    admin
      .from("commission_records")
      .select("id, trigger_type, commission_amount, calculated_at, status, analyst_id, introducer_id"),
    admin.from("journal_entries").select("source_id").eq("source_type", "commission_record"),
  ]);
  const postedOrderIds = new Set((postedOrderEntries ?? []).map((e) => e.source_id));
  const postedCommissionIds = new Set((postedCommissionEntries ?? []).map((e) => e.source_id));
  const unpostedOrders = (paidOrders ?? []).filter((o) => !postedOrderIds.has(o.id));
  const unpostedCommissions = (commissions ?? []).filter((c) => !postedCommissionIds.has(c.id));

  // Resolve a customer-name subject for detection_service orders — same
  // no-direct-FK pattern as listAllCommissions()/loadIndividualsByPartyIds.
  const orderIds = unpostedOrders.map((o) => o.id);
  const { data: orderItems } =
    orderIds.length > 0 ? await admin.from("order_items").select("order_id, customer_id").in("order_id", orderIds) : { data: [] };
  const customerIdsByOrder = new Map<string, string[]>();
  for (const oi of orderItems ?? []) {
    if (!oi.customer_id) continue;
    const arr = customerIdsByOrder.get(oi.order_id) ?? [];
    arr.push(oi.customer_id);
    customerIdsByOrder.set(oi.order_id, arr);
  }
  const allCustomerIds = [...new Set([...customerIdsByOrder.values()].flat())];
  const { data: customers } =
    allCustomerIds.length > 0 ? await admin.from("customers").select("id, party_id").in("id", allCustomerIds) : { data: [] };
  const partyIdByCustomer = new Map((customers ?? []).map((c) => [c.id, c.party_id]));
  const customerPartyIds = [...new Set((customers ?? []).map((c) => c.party_id))];

  // Resolve payee names for commissions — mirrors listAllCommissions().
  const analystIds = [...new Set(unpostedCommissions.filter((c) => c.analyst_id).map((c) => c.analyst_id as string))];
  const introducerIds = [...new Set(unpostedCommissions.filter((c) => c.introducer_id).map((c) => c.introducer_id as string))];
  const [{ data: analysts }, { data: introducers }] = await Promise.all([
    analystIds.length > 0 ? admin.from("analysts").select("id, party_id").in("id", analystIds) : Promise.resolve({ data: [] }),
    introducerIds.length > 0 ? admin.from("introducers").select("id, party_id").in("id", introducerIds) : Promise.resolve({ data: [] }),
  ]);
  const partyByAnalyst = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));
  const partyByIntroducer = new Map((introducers ?? []).map((i) => [i.id, i.party_id]));

  const allPartyIds = [...new Set([...customerPartyIds, ...(analysts ?? []).map((a) => a.party_id), ...(introducers ?? []).map((i) => i.party_id)])];
  const { data: identities } =
    allPartyIds.length > 0 ? await admin.from("individuals").select("party_id, full_name").in("party_id", allPartyIds) : { data: [] };
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));

  const orderRows: UnpostedTransactionRow[] = unpostedOrders.map((o) => {
    const custIds = [...new Set(customerIdsByOrder.get(o.id) ?? [])];
    const names = custIds.map((cid) => nameByParty.get(partyIdByCustomer.get(cid) ?? "") ?? null).filter((n): n is string => !!n);
    const subject = names.length === 0 ? "—" : names.length === 1 ? names[0] : `${names[0]} 等 ${names.length} 人`;
    return {
      type: "order",
      id: o.id,
      date: o.created_at.slice(0, 10),
      description: ORDER_TYPE_LABEL[o.order_type] ?? o.order_type,
      subject,
      amount: Number(o.total_amount),
      pending: false,
    };
  });

  const commissionRows: UnpostedTransactionRow[] = unpostedCommissions.map((c) => {
    const isIntroducer = !!c.introducer_id;
    const partyId = isIntroducer ? partyByIntroducer.get(c.introducer_id as string) : partyByAnalyst.get(c.analyst_id as string);
    return {
      type: "commission",
      id: c.id,
      date: c.calculated_at.slice(0, 10),
      description: TRIGGER_TYPE_LABEL[c.trigger_type] ?? c.trigger_type,
      subject: (partyId && nameByParty.get(partyId)) ?? "—",
      amount: Number(c.commission_amount),
      pending: c.status === "pending",
    };
  });

  return [...orderRows, ...commissionRows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
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

export interface ReportDeliverySummary {
  standardCount: number;
  upgradeCount: number;
  totalCount: number;
  totalCost: number;
}

// Report cost itself already flows into getProfitAndLossThisMonth()'s
// expense breakdown automatically (account 5600, auto-posted by
// calculate_report_override_commission() — see commission_engine.sql). This
// is just the count-by-tier the user separately asked for alongside the P&L.
export async function getReportDeliverySummaryThisMonth(): Promise<ReportDeliverySummary> {
  const admin = createAdminClient();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data: items } = await admin
    .from("order_items")
    .select("report_tier")
    .not("report_delivered_at", "is", null)
    .gte("report_delivered_at", monthStart);

  const standardCount = (items ?? []).filter((i) => i.report_tier === "standard").length;
  const upgradeCount = (items ?? []).filter((i) => i.report_tier === "upgrade").length;
  return {
    standardCount,
    upgradeCount,
    totalCount: standardCount + upgradeCount,
    totalCost: standardCount * 25 + upgradeCount * 125,
  };
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
