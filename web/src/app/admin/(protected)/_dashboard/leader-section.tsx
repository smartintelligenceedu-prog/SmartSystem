import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-l-[3px] border-l-[#0052CC] shadow-sm">
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

export async function LeaderSection({ analystId }: { analystId: string }) {
  // Uses the caller's own RLS-respecting session — team_summary() internally
  // verifies target_id belongs to the caller (or back office), matching the
  // "Leader cannot view another Leader's data" rule.
  const supabase = await createServerSupabaseClient();

  const { data: summaryRows } = await supabase.rpc("team_summary", { for_analyst_id: analystId });

  const summary = summaryRows?.[0] ?? {
    analyst_count: 0,
    customer_count: 0,
    session_count: 0,
    total_revenue: 0,
    yearly_revenue: 0,
    monthly_revenue: 0,
    team_commission_total: 0,
    yearly_team_commission: 0,
    monthly_team_commission: 0,
    pending_team_count: 0,
  };

  // "Commission this Month" is the leader's own commission_records for the
  // current calendar month — a plain self-scope read, already covered by the
  // commission_records RLS policy.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { data: myCommission } = await supabase
    .from("commission_records")
    .select("commission_amount")
    .eq("analyst_id", analystId)
    .gte("calculated_at", monthStart);
  const overrideSummary = (myCommission ?? []).reduce((total, r) => total + Number(r.commission_amount), 0);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("dashboard.leader.title")}</h2>
        <Button size="sm" variant="secondary" render={<Link href="/admin/team">{await t("dashboard.leader.view_team_link")}</Link>} />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label={await t("dashboard.leader.stat.team_summary")} value={String(summary.analyst_count)} />
        <StatCard label={await t("dashboard.leader.stat.team_sales")} value={formatMYR(summary.total_revenue)} />
        <StatCard label={await t("dashboard.leader.stat.team_sales_yearly")} value={formatMYR(summary.yearly_revenue)} />
        <StatCard label={await t("dashboard.leader.stat.team_sales_monthly")} value={formatMYR(summary.monthly_revenue)} />
        <StatCard label={await t("dashboard.leader.stat.team_commission")} value={formatMYR(summary.team_commission_total)} />
        <StatCard label={await t("dashboard.leader.stat.team_commission_yearly")} value={formatMYR(summary.yearly_team_commission)} />
        <StatCard label={await t("dashboard.leader.stat.team_commission_monthly")} value={formatMYR(summary.monthly_team_commission)} />
        <StatCard label={await t("dashboard.leader.stat.override_summary")} value={formatMYR(overrideSummary)} />
        <StatCard label={await t("dashboard.leader.stat.pending_team_approval")} value={String(summary.pending_team_count)} />
      </div>
      <p className="text-xs text-muted-foreground">{await t("dashboard.leader.note")}</p>
    </section>
  );
}
