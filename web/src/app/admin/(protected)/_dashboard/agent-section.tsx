import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import type { AnalystStatus } from "@/lib/types/registration";
import { VoucherProgressBar } from "../finance/institutional/voucher-progress-bar";
import { getAgentInstitutionalStats, getFollowUpChildren } from "./agent-institutional-stats";
import { TQC_TAG_I18N_KEY } from "@/lib/tqc-tags";
import { CopyLinkButton } from "../_components/copy-link-button";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

const STATUS_LABEL_KEY: Record<AnalystStatus, Parameters<typeof t>[0]> = {
  pending: "dashboard.agent.status.pending",
  approved: "dashboard.agent.status.approved",
  suspended: "dashboard.agent.status.suspended",
  rejected: "dashboard.agent.status.rejected",
  terminated: "dashboard.agent.status.terminated",
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
    { data: analystItems },
    { data: monthCommission },
    { count: pendingApprovalCount },
    { count: newCommissionCount },
  ] = await Promise.all([
    supabase.from("detection_vouchers").select("id", { count: "exact", head: true }).eq("analyst_id", analystId).eq("status", "issued"),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("owner_analyst_id", analystId),
    // Multi-person orders (migration 012): a sale is credited per order_item,
    // not per order, so "my sales" has to be scoped by order_items.analyst_id
    // rather than orders.analyst_id (which is just whoever submitted the
    // order). See the identical reasoning in reports/data.ts.
    supabase.from("order_items").select("id, order_id, subtotal").eq("analyst_id", analystId),
    supabase.from("commission_records").select("commission_amount").eq("analyst_id", analystId).gte("calculated_at", monthStart),
    supabase.from("commission_records").select("id", { count: "exact", head: true }).eq("analyst_id", analystId).eq("status", "pending"),
    supabase.from("commission_records").select("id", { count: "exact", head: true }).eq("analyst_id", analystId).gte("calculated_at", sevenDaysAgo),
  ]);

  const [institutionalStats, followUpChildren] = await Promise.all([
    getAgentInstitutionalStats(analystId),
    getFollowUpChildren(analystId),
  ]);

  const itemOrderIds = [...new Set((analystItems ?? []).map((it) => it.order_id))];
  const { data: itemOrders } =
    itemOrderIds.length > 0
      ? await supabase.from("orders").select("id, status, order_type, created_at").in("id", itemOrderIds)
      : { data: [] };
  const orderById = new Map((itemOrders ?? []).map((o) => [o.id, o]));

  const totalSalesOrders = (analystItems ?? []).filter((it) => orderById.get(it.order_id)?.order_type === "detection_service").length;

  const pendingOrders = (analystItems ?? []).filter((it) => orderById.get(it.order_id)?.status === "pending").length;

  const monthlySales = (analystItems ?? []).reduce((total, it) => {
    const order = orderById.get(it.order_id);
    if (!order || order.status !== "paid" || order.created_at < monthStart) return total;
    return total + Number(it.subtotal);
  }, 0);

  const commissionThisMonth = (monthCommission ?? []).reduce((total, c) => total + Number(c.commission_amount), 0);

  const notifications = [
    (pendingApprovalCount ?? 0) > 0 && {
      label: t("dashboard.agent.notification.pending_approval.label"),
      detail: `${pendingApprovalCount} ${t("dashboard.agent.notification.pending_approval.suffix")}`,
    },
    (newCommissionCount ?? 0) > 0 && {
      label: t("dashboard.agent.notification.new_commission.label"),
      detail: `${t("dashboard.agent.notification.new_commission.prefix")} ${newCommissionCount} ${t("dashboard.agent.notification.new_commission.suffix")}`,
    },
  ].filter((n): n is { label: string; detail: string } => !!n);

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("dashboard.agent.title")}</h2>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <div>
            <p className="text-lg font-semibold">
              {identity?.full_name ?? "—"} <span className="text-sm font-normal text-muted-foreground">({identity?.nickname})</span>
            </p>
            <p className="text-sm text-muted-foreground">
              {t("dashboard.agent.field.agent_id")}: {analyst?.referral_code}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {analyst?.referral_code && (
              <CopyLinkButton path={`/register?ref=${analyst.referral_code}`} label={t("dashboard.agent.copy_referral_link")} />
            )}
            <Badge variant="secondary">{t(STATUS_LABEL_KEY[(analyst?.status as AnalystStatus) ?? "pending"])}</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard label={t("dashboard.agent.stat.available_report_credit")} value={String(availableCredit ?? 0)} />
        <StatCard label={t("dashboard.agent.stat.total_customers")} value={String(totalCustomers ?? 0)} />
        <StatCard label={t("dashboard.agent.stat.total_sales_orders")} value={String(totalSalesOrders ?? 0)} />
        <StatCard label={t("dashboard.agent.stat.monthly_sales")} value={formatMYR(monthlySales)} />
        <StatCard label={t("dashboard.agent.stat.pending_orders")} value={String(pendingOrders ?? 0)} />
        <StatCard label={t("dashboard.agent.stat.commission_this_month")} value={formatMYR(commissionThisMonth)} />
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("dashboard.agent.section.institutional")}</h3>
        <Card>
          <CardContent className="flex flex-wrap items-center gap-6 pt-6">
            <VoucherProgressBar total={institutionalStats.voucher_total} used={institutionalStats.voucher_used} />
            <div className="grid flex-1 grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">{t("dashboard.agent.stat.institution_count")}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{institutionalStats.institution_count}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("dashboard.agent.stat.assessed_children")}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{institutionalStats.assessed_children_count}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("dashboard.agent.stat.new_children_this_month")}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{institutionalStats.new_children_this_month}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("dashboard.agent.followup.title")}</h3>
        <div className="divide-y rounded-md border">
          {followUpChildren.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("dashboard.agent.followup.empty")}</p>}
          {followUpChildren.map((c) => (
            <Link
              key={c.child_id}
              href={`/admin/customers/children/${c.child_id}/report`}
              className="flex items-center justify-between px-4 py-3 text-sm hover:bg-accent/50"
            >
              <div>
                <p className="font-medium">{c.full_name}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {t((TQC_TAG_I18N_KEY[tag] ?? tag) as Parameters<typeof t>[0])}
                    </Badge>
                  ))}
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t("dashboard.agent.followup.days_since_prefix")} {c.days_since_assessment} {t("dashboard.agent.followup.days_since_suffix")}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("dashboard.agent.quick_actions")}</h3>
        <div className="flex flex-wrap gap-2">
          {/* Base UI Button uses a `render` prop instead of Radix's asChild —
              see the same note in select.tsx. */}
          <Button size="sm" render={<Link href="/admin/customers/new">{t("dashboard.agent.action.register_customer")}</Link>} />
          <Button size="sm" variant="secondary" render={<Link href="/admin/sales-orders/new">{t("dashboard.agent.action.new_sales_order")}</Link>} />
          <Button size="sm" variant="secondary" render={<Link href="/admin/customers">{t("dashboard.agent.action.view_customers")}</Link>} />
          <Button size="sm" variant="secondary" render={<Link href="/admin/commission">{t("dashboard.agent.action.my_commission")}</Link>} />
          <Button size="sm" variant="secondary" render={<Link href="/admin/reports">{t("dashboard.agent.action.my_reports")}</Link>} />
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("dashboard.agent.notifications")}</h3>
        <div className="divide-y rounded-md border">
          {notifications.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("dashboard.agent.notifications.empty")}</p>}
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
