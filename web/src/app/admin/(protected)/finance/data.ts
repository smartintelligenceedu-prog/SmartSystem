import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { t, type TranslationKey } from "@/lib/i18n";
import { resolveCommissionSourceNames } from "../commission/data";

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

const ORDER_TYPE_KEY = {
  registration: "finance.order_type.registration",
  detection_service: "finance.order_type.detection_service",
} satisfies Record<string, TranslationKey>;

const TRIGGER_TYPE_KEY = {
  personal_sale: "payroll.trigger_type.personal_sale",
  pic_channel: "payroll.trigger_type.pic_channel",
  introducer: "payroll.trigger_type.introducer",
  recruitment: "payroll.trigger_type.recruitment",
  voucher_resale: "payroll.trigger_type.voucher_resale",
  report_override: "payroll.trigger_type.report_override",
  analyst_report_fee: "payroll.trigger_type.analyst_report_fee",
} satisfies Record<string, TranslationKey>;

export interface UnpostedTransactionRow {
  type: "order" | "commission";
  id: string;
  date: string;
  description: string;
  subject: string;
  amount: number;
  pending: boolean;
  // Commission rows only — who actually generated it (e.g. the downline
  // whose report earned a leader's override) and which customer's order it
  // came from, so back office isn't just posting a bare "Lee Yan Leh RM100"
  // line with no way to tell which agent/customer it traces back to. Reuses
  // the same resolution commission/data.ts's own page already shows —
  // see resolveCommissionSourceNames().
  source_name: string | null;
  customer_name: string | null;
  direct_sponsor_name: string | null;
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
      .select("id, trigger_type, commission_amount, calculated_at, status, analyst_id, introducer_id, source_transaction_type, source_transaction_id"),
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

  // Same "which agent / which customer did this actually come from" lookup
  // the Commission page uses — see the field comment on UnpostedTransactionRow.
  const commissionSourceById = await resolveCommissionSourceNames(unpostedCommissions);

  // t() is async (locale-aware) and can't be called inside a plain .map()
  // callback — resolved up front instead.
  const [andOthersSuffix, peopleSuffix] = await Promise.all([t("finance.list.and_others_suffix"), t("finance.list.people_suffix")]);
  const orderTypeLabelByType = Object.fromEntries(
    await Promise.all(Object.entries(ORDER_TYPE_KEY).map(async ([k, key]) => [k, await t(key)]))
  ) as Record<string, string>;
  const triggerTypeLabelByType = Object.fromEntries(
    await Promise.all(Object.entries(TRIGGER_TYPE_KEY).map(async ([k, key]) => [k, await t(key)]))
  ) as Record<string, string>;

  const orderRows: UnpostedTransactionRow[] = unpostedOrders.map((o) => {
    const custIds = [...new Set(customerIdsByOrder.get(o.id) ?? [])];
    const names = custIds.map((cid) => nameByParty.get(partyIdByCustomer.get(cid) ?? "") ?? null).filter((n): n is string => !!n);
    const subject = names.length === 0 ? "—" : names.length === 1 ? names[0] : `${names[0]}${andOthersSuffix}${names.length}${peopleSuffix}`;
    return {
      type: "order",
      id: o.id,
      date: o.created_at.slice(0, 10),
      description: orderTypeLabelByType[o.order_type] ?? o.order_type,
      subject,
      amount: Number(o.total_amount),
      pending: false,
      source_name: null,
      customer_name: null,
      direct_sponsor_name: null,
    };
  });

  const commissionRows: UnpostedTransactionRow[] = unpostedCommissions.map((c) => {
    const isIntroducer = !!c.introducer_id;
    const partyId = isIntroducer ? partyByIntroducer.get(c.introducer_id as string) : partyByAnalyst.get(c.analyst_id as string);
    const source = commissionSourceById.get(c.id);
    return {
      type: "commission",
      id: c.id,
      date: c.calculated_at.slice(0, 10),
      description: triggerTypeLabelByType[c.trigger_type] ?? c.trigger_type,
      subject: (partyId && nameByParty.get(partyId)) ?? "—",
      amount: Number(c.commission_amount),
      pending: c.status === "pending",
      source_name: source?.name ?? null,
      customer_name: source?.customerName ?? null,
      direct_sponsor_name: source?.directSponsorName ?? null,
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
  commission: AccountBalance[];
  expense: AccountBalance[];
  totalRevenue: number;
  totalCommission: number;
  totalExpense: number;
  netProfit: number;
}

// "YYYY-MM" x2 -> the [start, end) date bounds spanning from the first day
// of fromMonth through the last day of toMonth, end exclusive (first day of
// the month after toMonth) so a query never has to guess how many days are
// in a given month. A single-month view is just fromMonth === toMonth.
function monthRangeBounds(fromMonth: string, toMonth: string): { start: string; end: string } {
  const [, toYear, toMon] = toMonth.match(/^(\d{4})-(\d{2})$/)!.map(Number);
  const start = `${fromMonth}-01`;
  const endDate = new Date(toYear, toMon, 1); // toMon is 1-indexed already, so this is the 1st of the month after toMonth
  const end = endDate.toISOString().slice(0, 10);
  return { start, end };
}

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

// Real P&L computed from posted journal_lines — distinct from the Admin
// Dashboard's "Monthly Sales - commission expense" estimate, which reads
// orders/commission_records directly and includes unposted transactions.
// The two will diverge until back office posts everything; that's expected
// during the transition, not a bug. `fromMonth`/`toMonth` are "YYYY-MM",
// inclusive on both ends — a single-month view just passes the same value
// for both. A back-dated expense entered today for an earlier month shows
// up when that month is in range, not only in whichever month happens to
// be open right now.
export async function getProfitAndLoss(fromMonth: string, toMonth: string): Promise<ProfitAndLoss> {
  const admin = createAdminClient();
  const { start: monthStart, end: monthEnd } = monthRangeBounds(fromMonth, toMonth);

  const { data: accounts } = await admin
    .from("chart_of_accounts")
    .select("id, code, name, account_type")
    .in("account_type", ["revenue", "expense"]);
  const { data: entries } = await admin.from("journal_entries").select("id").gte("entry_date", monthStart).lt("entry_date", monthEnd);
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
  const commission: AccountBalance[] = [];
  const expense: AccountBalance[] = [];
  for (const a of accounts ?? []) {
    const totals = byAccount.get(a.id) ?? { debit: 0, credit: 0 };
    if (a.account_type === "revenue") {
      revenue.push({ code: a.code, name: a.name, balance: totals.credit - totals.debit });
    } else if (a.name.startsWith("Commission Expense")) {
      // Payouts to analysts/introducers/PIC — kept separate from the
      // company's own costs (report production, operating expenses) so
      // back office can see "money paid out to the team" distinctly from
      // "money the company itself spent". Split by name prefix rather than
      // account_type/code range since 5600 报告制作成本 (report COGS) sits in
      // the same 5xxx code block but isn't a commission payout.
      commission.push({ code: a.code, name: a.name, balance: totals.debit - totals.credit });
    } else {
      expense.push({ code: a.code, name: a.name, balance: totals.debit - totals.credit });
    }
  }

  const totalRevenue = revenue.reduce((s, r) => s + r.balance, 0);
  const totalCommission = commission.reduce((s, c) => s + c.balance, 0);
  const totalExpense = expense.reduce((s, e) => s + e.balance, 0);

  return {
    revenue,
    commission,
    expense,
    totalRevenue,
    totalCommission,
    totalExpense,
    netProfit: totalRevenue - totalCommission - totalExpense,
  };
}

export interface ReportDeliverySummary {
  standardCount: number;
  upgradeCount: number;
  totalCount: number;
  totalCost: number;
}

// Report cost itself already flows into getProfitAndLoss()'s expense
// breakdown automatically (account 5600, auto-posted by
// calculate_report_override_commission() — see commission_engine.sql). This
// is just the count-by-tier the user separately asked for alongside the P&L.
export async function getReportDeliverySummary(fromMonth: string, toMonth: string): Promise<ReportDeliverySummary> {
  const admin = createAdminClient();
  const { start: monthStart, end: monthEnd } = monthRangeBounds(fromMonth, toMonth);

  const { data: items } = await admin
    .from("order_items")
    .select("report_tier")
    .not("report_delivered_at", "is", null)
    .gte("report_delivered_at", monthStart)
    .lt("report_delivered_at", monthEnd);

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
  // Only 'manual_expense' entries currently support voiding (void_manual_expense,
  // migration 053) — used to decide whether to show the void action/badge.
  source_type: string;
  status: string;
  lines: { account_code: string; account_name: string; debit: number; credit: number }[];
}

// Lists every entry posted for the given month (not just the most recent
// N) — a back-dated expense entered late should still show up when the
// user is reviewing that month's books, no matter how many entries were
// posted after it. `month` is "YYYY-MM".
export async function listJournalEntriesForMonth(fromMonth: string, toMonth: string): Promise<JournalEntryRow[]> {
  const admin = createAdminClient();
  const { start: monthStart, end: monthEnd } = monthRangeBounds(fromMonth, toMonth);
  const { data: entries } = await admin
    .from("journal_entries")
    .select("id, entry_date, description, source_type, status")
    .gte("entry_date", monthStart)
    .lt("entry_date", monthEnd)
    .order("entry_date", { ascending: false })
    .order("posted_at", { ascending: false });
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
    source_type: e.source_type,
    status: e.status,
    lines: linesByEntry.get(e.id) ?? [],
  }));
}
