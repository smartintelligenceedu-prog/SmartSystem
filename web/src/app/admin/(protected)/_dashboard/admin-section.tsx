import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AnalystStatus } from "@/lib/types/registration";
import { t, type TranslationKey } from "@/lib/i18n";

const STATUS_KEY: Record<AnalystStatus, TranslationKey> = {
  pending: "dashboard.agent.status.pending",
  approved: "dashboard.agent.status.approved",
  suspended: "dashboard.agent.status.suspended",
  rejected: "dashboard.agent.status.rejected",
  terminated: "dashboard.agent.status.terminated",
};

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

function sum(rows: { commission_amount?: number; total_amount?: number }[] | null, key: "commission_amount" | "total_amount") {
  return (rows ?? []).reduce((total, r) => total + Number(r[key] ?? 0), 0);
}

async function getAdminStats() {
  const admin = createAdminClient();

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [
    totalAgent,
    pendingRegistration,
    pendingPaymentVerification,
    todaySales,
    monthSales,
    todayCommission,
    monthCommission,
    recent,
  ] = await Promise.all([
    admin.from("analysts").select("id", { count: "exact", head: true }).eq("status", "approved"),
    admin.from("analysts").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending").eq("order_type", "detection_service"),
    admin.from("orders").select("total_amount").eq("status", "paid").gte("created_at", todayStart),
    admin.from("orders").select("total_amount").eq("status", "paid").gte("created_at", monthStart),
    admin.from("commission_records").select("commission_amount, trigger_type").gte("calculated_at", todayStart),
    admin.from("commission_records").select("commission_amount, trigger_type").gte("calculated_at", monthStart),
    admin.from("analysts").select("id, status, created_at, party_id").order("created_at", { ascending: false }).limit(5),
  ]);

  const recentPartyIds = (recent.data ?? []).map((r) => r.party_id);
  const { data: identities } = await admin
    .from("individuals")
    .select("party_id, full_name")
    .in("party_id", recentPartyIds.length > 0 ? recentPartyIds : ["00000000-0000-0000-0000-000000000000"]);
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));

  const todayCommissionRows = todayCommission.data ?? [];
  const monthCommissionRows = monthCommission.data ?? [];
  const todayOverride = sum(todayCommissionRows.filter((r) => r.trigger_type === "recruitment"), "commission_amount");
  const todayCommissionOnly = sum(todayCommissionRows.filter((r) => r.trigger_type !== "recruitment"), "commission_amount");
  const monthExpenses = sum(monthCommissionRows, "commission_amount");
  const monthSalesTotal = sum(monthSales.data, "total_amount");

  return {
    todaySales: sum(todaySales.data, "total_amount"),
    monthSales: monthSalesTotal,
    totalAgent: totalAgent.count ?? 0,
    pendingRegistration: pendingRegistration.count ?? 0,
    pendingPaymentVerification: pendingPaymentVerification.count ?? 0,
    todayCommission: todayCommissionOnly,
    todayOverride,
    monthExpenses,
    netProfit: monthSalesTotal - monthExpenses,
    recent: (recent.data ?? []).map((r) => ({
      id: r.id,
      status: r.status as AnalystStatus,
      created_at: r.created_at,
      full_name: nameByParty.get(r.party_id) ?? "—",
    })),
  };
}

function StatCard({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export async function AdminSection() {
  const stats = await getAdminStats();

  const statusLabelByStatus = Object.fromEntries(
    await Promise.all(Object.entries(STATUS_KEY).map(async ([k, key]) => [k, await t(key)]))
  ) as Record<AnalystStatus, string>;

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("dashboard.admin.title")}</h2>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label={await t("dashboard.admin.stat.todays_sales")} value={formatMYR(stats.todaySales)} />
        <StatCard label={await t("dashboard.admin.stat.monthly_sales")} value={formatMYR(stats.monthSales)} />
        <StatCard label={await t("dashboard.admin.stat.total_agent")} value={String(stats.totalAgent)} href="/admin/registrations?status=approved" />
        <StatCard label={await t("dashboard.admin.stat.pending_registration")} value={String(stats.pendingRegistration)} href="/admin/registrations?status=pending" />
        <StatCard
          label={await t("dashboard.admin.stat.pending_payment_verification")}
          value={String(stats.pendingPaymentVerification)}
          href="/admin/sales-orders?status=pending"
        />
        <StatCard label={await t("dashboard.admin.stat.todays_commission")} value={formatMYR(stats.todayCommission)} />
        <StatCard label={await t("dashboard.admin.stat.todays_override")} value={formatMYR(stats.todayOverride)} />
        <StatCard label={await t("dashboard.admin.stat.monthly_expenses")} value={formatMYR(stats.monthExpenses)} />
        <StatCard label={await t("dashboard.admin.stat.net_profit")} value={formatMYR(stats.netProfit)} />
      </div>
      <p className="text-xs text-muted-foreground">{await t("dashboard.admin.net_profit_note")}</p>

      <div>
        <h3 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("dashboard.admin.recent_activities")}</h3>
        <div className="divide-y rounded-md border">
          {stats.recent.length === 0 && <p className="p-4 text-sm text-muted-foreground">{await t("dashboard.admin.empty")}</p>}
          {stats.recent.map((r) => (
            <Link
              key={r.id}
              href={`/admin/registrations/${r.id}`}
              className="flex items-center justify-between px-4 py-3 text-sm hover:bg-accent/50"
            >
              <span>{r.full_name}</span>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground tabular-nums">
                  {new Date(r.created_at).toLocaleDateString("zh-CN")}
                </span>
                <Badge variant="secondary">{statusLabelByStatus[r.status]}</Badge>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
