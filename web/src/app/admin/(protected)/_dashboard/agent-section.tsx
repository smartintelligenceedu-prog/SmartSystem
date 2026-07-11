import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AnalystStatus } from "@/lib/types/registration";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

const STATUS_LABEL: Record<AnalystStatus, string> = {
  pending: "待审核",
  approved: "已核准",
  suspended: "已暂停",
  rejected: "已拒绝",
  terminated: "已终止",
};

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

export async function AgentSection({ analystId }: { analystId: string }) {
  // Plain self-scope reads — every table here already has an
  // "owner/analyst_id = current_analyst_id() or back office" RLS policy, so
  // this uses the caller's own session rather than the service-role client.
  const supabase = await createServerSupabaseClient();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: analyst } = await supabase.from("analysts").select("referral_code, status, party_id").eq("id", analystId).single();
  const { data: identity } = await supabase.from("individuals").select("full_name, nickname").eq("party_id", analyst?.party_id ?? "").maybeSingle();

  const [
    { count: availableCredit },
    { count: totalCustomers },
    { count: totalSalesOrders },
    { data: monthOrders },
    { count: pendingOrders },
    { data: monthCommission },
    { count: pendingApprovalCount },
    { count: newCommissionCount },
  ] = await Promise.all([
    supabase.from("detection_vouchers").select("id", { count: "exact", head: true }).eq("analyst_id", analystId).eq("status", "issued"),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("owner_analyst_id", analystId),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("analyst_id", analystId).eq("order_type", "detection_service"),
    supabase.from("orders").select("total_amount").eq("analyst_id", analystId).eq("status", "paid").gte("created_at", monthStart),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("analyst_id", analystId).eq("status", "pending"),
    supabase.from("commission_records").select("commission_amount").eq("analyst_id", analystId).gte("calculated_at", monthStart),
    supabase.from("commission_records").select("id", { count: "exact", head: true }).eq("analyst_id", analystId).eq("status", "pending"),
    supabase.from("commission_records").select("id", { count: "exact", head: true }).eq("analyst_id", analystId).gte("calculated_at", sevenDaysAgo),
  ]);

  const monthlySales = (monthOrders ?? []).reduce((total, o) => total + Number(o.total_amount), 0);
  const commissionThisMonth = (monthCommission ?? []).reduce((total, c) => total + Number(c.commission_amount), 0);

  const notifications = [
    (pendingApprovalCount ?? 0) > 0 && { label: "Pending Approval", detail: `${pendingApprovalCount} 笔佣金待核准发放` },
    (newCommissionCount ?? 0) > 0 && { label: "New Commission", detail: `近 7 天有 ${newCommissionCount} 笔新佣金入帐` },
  ].filter((n): n is { label: string; detail: string } => !!n);

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">我的工作台（Agent）</h2>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <div>
            <p className="text-lg font-semibold">
              {identity?.full_name ?? "—"} <span className="text-sm font-normal text-muted-foreground">({identity?.nickname})</span>
            </p>
            <p className="text-sm text-muted-foreground">Agent ID: {analyst?.referral_code}</p>
          </div>
          <Badge variant="secondary">{STATUS_LABEL[(analyst?.status as AnalystStatus) ?? "pending"]}</Badge>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard label="Available Report Credit" value={String(availableCredit ?? 0)} />
        <StatCard label="Total Customers" value={String(totalCustomers ?? 0)} />
        <StatCard label="Total Sales Orders" value={String(totalSalesOrders ?? 0)} />
        <StatCard label="Monthly Sales" value={formatMYR(monthlySales)} />
        <StatCard label="Pending Orders" value={String(pendingOrders ?? 0)} />
        <StatCard label="Commission This Month" value={formatMYR(commissionThisMonth)} />
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">Quick Actions</h3>
        <div className="flex flex-wrap gap-2">
          {/* Base UI Button uses a `render` prop instead of Radix's asChild —
              see the same note in select.tsx. */}
          <Button size="sm" render={<Link href="/admin/customers/new">Register Customer</Link>} />
          <Button size="sm" variant="secondary" render={<Link href="/admin/sales-orders/new">New Sales Order</Link>} />
          <Button size="sm" variant="secondary" render={<Link href="/admin/customers">View Customers</Link>} />
          <Button size="sm" variant="secondary" render={<Link href="/admin/commission">My Commission</Link>} />
          <Button size="sm" variant="secondary" render={<Link href="/admin/reports">My Reports</Link>} />
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">Notifications</h3>
        <div className="divide-y rounded-md border">
          {notifications.length === 0 && <p className="p-4 text-sm text-muted-foreground">暂无通知</p>}
          {notifications.map((n) => (
            <div key={n.label} className="px-4 py-3 text-sm">
              <p className="font-medium">{n.label}</p>
              <p className="text-muted-foreground">{n.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
