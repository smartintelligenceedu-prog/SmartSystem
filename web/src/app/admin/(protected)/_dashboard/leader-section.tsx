import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { t, type TranslationKey } from "@/lib/i18n";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

const STATUS_KEY: Record<string, TranslationKey> = {
  pending: "dashboard.agent.status.pending",
  approved: "dashboard.agent.status.approved",
  suspended: "dashboard.agent.status.suspended",
  rejected: "dashboard.agent.status.rejected",
  terminated: "dashboard.agent.status.terminated",
};

interface TeamMember {
  analyst_id: string;
  full_name: string;
  status: string;
  customer_count: number;
  revenue: number;
}

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

export async function LeaderSection({ analystId }: { analystId: string }) {
  // Uses the caller's own RLS-respecting session — team_summary()/team_members()
  // internally verify target_id belongs to the caller (or back office),
  // matching the "Leader cannot view another Leader's data" rule.
  const supabase = await createServerSupabaseClient();

  const [{ data: summaryRows }, { data: members }] = await Promise.all([
    supabase.rpc("team_summary", { for_analyst_id: analystId }),
    supabase.rpc("team_members", { for_analyst_id: analystId }) as unknown as Promise<{ data: TeamMember[] | null }>,
  ]);

  const summary = summaryRows?.[0] ?? {
    analyst_count: 0,
    customer_count: 0,
    session_count: 0,
    total_revenue: 0,
    team_commission_total: 0,
    pending_team_count: 0,
  };

  // My Override Summary is the leader's own commission_records — a plain
  // self-scope read, already covered by the commission_records RLS policy.
  const { data: myCommission } = await supabase.from("commission_records").select("commission_amount").eq("analyst_id", analystId);
  const overrideSummary = (myCommission ?? []).reduce((total, r) => total + Number(r.commission_amount), 0);

  const statusLabelByStatus = Object.fromEntries(
    await Promise.all(Object.entries(STATUS_KEY).map(async ([k, key]) => [k, await t(key)]))
  ) as Record<string, string>;
  const customerCountSuffix = await t("dashboard.leader.customer_count_suffix");

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("dashboard.leader.title")}</h2>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label={await t("dashboard.leader.stat.team_summary")} value={String(summary.analyst_count)} />
        <StatCard label={await t("dashboard.leader.stat.team_sales")} value={formatMYR(summary.total_revenue)} />
        <StatCard label={await t("dashboard.leader.stat.team_commission")} value={formatMYR(summary.team_commission_total)} />
        <StatCard label={await t("dashboard.leader.stat.override_summary")} value={formatMYR(overrideSummary)} />
        <StatCard label={await t("dashboard.leader.stat.pending_team_approval")} value={String(summary.pending_team_count)} />
      </div>
      <p className="text-xs text-muted-foreground">{await t("dashboard.leader.note")}</p>

      <div>
        <h3 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("dashboard.leader.team_performance")}</h3>
        <div className="divide-y rounded-md border">
          {(!members || members.length === 0) && <p className="p-4 text-sm text-muted-foreground">{await t("dashboard.leader.empty_members")}</p>}
          {members?.map((m) => (
            <div key={m.analyst_id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>{m.full_name}</span>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground tabular-nums">{m.customer_count}{customerCountSuffix}</span>
                <span className="tabular-nums">{formatMYR(m.revenue)}</span>
                <Badge variant="secondary">{statusLabelByStatus[m.status] ?? m.status}</Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
