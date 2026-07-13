import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type AnalyticsPeriod = "month" | "quarter";

export interface FinancialSummary {
  total_revenue: number;
  accounts_receivable: number;
  recognized_revenue: number;
}

export interface TopInstitution {
  institution_name: string;
  voucher_used: number;
  voucher_total: number;
}

export interface MonthlyTrendPoint {
  month: string;
  order_count: number;
  voucher_used_count: number;
}

export interface FinancialAnalytics {
  summary: FinancialSummary;
  top_institutions: TopInstitution[];
  monthly_trend: MonthlyTrendPoint[];
}

interface InstitutionalOrderAgg {
  id: string;
  total_amount: number;
  created_at: string;
  institution_party_id: string | null;
  voucher_total: number;
  voucher_used: number;
  ar_balance: number;
}

// Institutional/B2B orders only (billing_mode = 'invoice') — the consumer
// walk-in pay-now/voucher flow is a separate revenue stream not in scope
// for this management dashboard. ar_balance mirrors the derivation in
// finance/institutional/data.ts's listInstitutionalOrders(): outstanding
// balance nets off deposits already collected against a final settlement
// invoice, and is 0 once the order itself is paid/cancelled/refunded.
async function getInstitutionalOrdersAgg(): Promise<InstitutionalOrderAgg[]> {
  const admin = createAdminClient();

  const { data: orders } = await admin
    .from("orders")
    .select("id, total_amount, status, created_at, institution_party_id")
    .eq("billing_mode", "invoice");
  if (!orders || orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const [{ data: vouchers }, { data: invoices }, { data: payments }] = await Promise.all([
    admin.from("institutional_vouchers").select("order_id, status").in("order_id", orderIds),
    admin.from("invoices").select("order_id, invoice_type, status, amount").in("order_id", orderIds),
    admin.from("payments").select("order_id, amount, payment_type").in("order_id", orderIds),
  ]);

  return orders.map((o) => {
    const orderVouchers = (vouchers ?? []).filter((v) => v.order_id === o.id);
    const voucherTotal = orderVouchers.length;
    const voucherUsed = orderVouchers.filter((v) => v.status === "used").length;

    const orderInvoices = (invoices ?? []).filter((i) => i.order_id === o.id);
    const orderPayments = (payments ?? []).filter((p) => p.order_id === o.id);
    const depositTotal = orderPayments.filter((p) => p.payment_type === "deposit").reduce((s, p) => s + Number(p.amount), 0);
    const finalInvoice = orderInvoices.find((i) => i.invoice_type === "final_settlement" && i.status === "issued");
    const standardInvoice = orderInvoices.find((i) => i.invoice_type === "standard" && i.status === "issued");

    let arBalance = 0;
    if (o.status !== "paid" && o.status !== "cancelled" && o.status !== "refunded") {
      if (finalInvoice) arBalance = Number(finalInvoice.amount) - depositTotal;
      else if (standardInvoice) arBalance = Number(standardInvoice.amount);
    }

    return {
      id: o.id,
      total_amount: Number(o.total_amount),
      created_at: o.created_at,
      institution_party_id: o.institution_party_id,
      voucher_total: voucherTotal,
      voucher_used: voucherUsed,
      ar_balance: Math.max(0, arBalance),
    };
  });
}

function periodStart(period: AnalyticsPeriod): Date {
  const now = new Date();
  if (period === "quarter") {
    const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
    return new Date(now.getFullYear(), quarterMonth, 1);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

const TOP_INSTITUTIONS_LIMIT = 5;
const TREND_MONTHS = 6;

// Single entry point for the Management Financial Analytics dashboard — one
// fetch of the institutional order set, reused for the summary cards, the
// top-institutions ranking, and the monthly trend, rather than repeating
// the same set of joins three times per page load.
export async function getFinancialAnalytics(period: AnalyticsPeriod): Promise<FinancialAnalytics> {
  const admin = createAdminClient();
  const orders = await getInstitutionalOrdersAgg();

  const start = periodStart(period).toISOString();
  const periodOrders = orders.filter((o) => o.created_at >= start);

  const totalRevenue = periodOrders.reduce((s, o) => s + o.total_amount, 0);
  // A/R is a point-in-time outstanding balance, not scoped to the selected
  // period — an unpaid invoice from two months ago is still owed today.
  const accountsReceivable = orders.reduce((s, o) => s + o.ar_balance, 0);
  // "Recognized Revenue" — the most conservative recognition method per the
  // brief: only the fraction of an order's value whose voucher has actually
  // been redeemed (a brain-wave assessment actually happened) counts as
  // real, booked revenue. Orders with no vouchers issued yet contribute 0.
  const recognizedRevenue = periodOrders.reduce((s, o) => {
    if (o.voucher_total === 0) return s;
    return s + (o.total_amount / o.voucher_total) * o.voucher_used;
  }, 0);

  const byInstitution = new Map<string, { used: number; total: number }>();
  for (const o of orders) {
    if (!o.institution_party_id) continue;
    const existing = byInstitution.get(o.institution_party_id) ?? { used: 0, total: 0 };
    existing.used += o.voucher_used;
    existing.total += o.voucher_total;
    byInstitution.set(o.institution_party_id, existing);
  }
  const institutionIds = [...byInstitution.keys()];
  const { data: orgs } =
    institutionIds.length > 0 ? await admin.from("organizations").select("party_id, legal_name").in("party_id", institutionIds) : { data: [] };
  const nameByParty = new Map((orgs ?? []).map((o) => [o.party_id, o.legal_name]));

  const topInstitutions = institutionIds
    .map((id) => ({
      institution_name: nameByParty.get(id) ?? "—",
      voucher_used: byInstitution.get(id)!.used,
      voucher_total: byInstitution.get(id)!.total,
    }))
    .sort((a, b) => b.voucher_used - a.voucher_used)
    .slice(0, TOP_INSTITUTIONS_LIMIT);

  const orderIds = orders.map((o) => o.id);
  const { data: usedVouchers } =
    orderIds.length > 0
      ? await admin.from("institutional_vouchers").select("order_id, used_at").in("order_id", orderIds).eq("status", "used")
      : { data: [] };

  const now = new Date();
  const monthlyTrend: MonthlyTrendPoint[] = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
    const monthStart = monthDate;
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);

    const orderCount = orders.filter((o) => {
      const d = new Date(o.created_at);
      return d >= monthStart && d < monthEnd;
    }).length;

    const voucherUsedCount = (usedVouchers ?? []).filter((v) => {
      if (!v.used_at) return false;
      const d = new Date(v.used_at);
      return d >= monthStart && d < monthEnd;
    }).length;

    monthlyTrend.push({ month: monthKey, order_count: orderCount, voucher_used_count: voucherUsedCount });
  }

  return {
    summary: { total_revenue: totalRevenue, accounts_receivable: accountsReceivable, recognized_revenue: recognizedRevenue },
    top_institutions: topInstitutions,
    monthly_trend: monthlyTrend,
  };
}
