import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AnalystStatus } from "@/lib/types/registration";

const STATUS_LABEL: Record<AnalystStatus, string> = {
  pending: "待审核",
  approved: "已核准",
  suspended: "已暂停",
  rejected: "已拒绝",
  terminated: "已终止",
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

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">公司营运总览</h2>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Today's Sales" value={formatMYR(stats.todaySales)} />
        <StatCard label="Monthly Sales" value={formatMYR(stats.monthSales)} />
        <StatCard label="Total Agent" value={String(stats.totalAgent)} href="/admin/registrations?status=approved" />
        <StatCard label="Pending Registration" value={String(stats.pendingRegistration)} href="/admin/registrations?status=pending" />
        <StatCard label="Pending Payment Verification" value={String(stats.pendingPaymentVerification)} />
        <StatCard label="Today's Commission" value={formatMYR(stats.todayCommission)} />
        <StatCard label="Today's Override" value={formatMYR(stats.todayOverride)} />
        <StatCard label="Monthly Expenses" value={formatMYR(stats.monthExpenses)} />
        <StatCard label="Net Profit" value={formatMYR(stats.netProfit)} />
      </div>
      <p className="text-xs text-muted-foreground">
        Net Profit 目前是「Monthly Sales − 佣金支出」的简化估算，还没有接上正式总帐（Chart of Accounts）过帐，等财务模组做总帐自动过帐后会换成真实做帐数字。「Monthly
        Profit」跟 Net Profit 是同一个数字，避免看板上重复显示同一笔钱两次。
      </p>

      <div>
        <h3 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">Recent Activities</h3>
        <div className="divide-y rounded-md border">
          {stats.recent.length === 0 && <p className="p-4 text-sm text-muted-foreground">暂无资料</p>}
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
                <Badge variant="secondary">{STATUS_LABEL[r.status]}</Badge>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
