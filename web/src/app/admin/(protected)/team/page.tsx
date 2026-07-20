import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasRole } from "@/lib/auth/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { t, type TranslationKey } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

const STATUS_KEY = {
  pending: "dashboard.agent.status.pending",
  approved: "dashboard.agent.status.approved",
  suspended: "dashboard.agent.status.suspended",
  rejected: "dashboard.agent.status.rejected",
  terminated: "dashboard.agent.status.terminated",
} satisfies Record<string, TranslationKey>;

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

// Same aggregate-only pattern as the Leader dashboard section — team_summary()/
// team_members() enforce "Leader cannot view another Leader's data" internally,
// so this page is just a fuller display of the same RPCs, not a separate
// access path.
export default async function TeamPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!hasRole(context, "leader") || !context.analystId) redirect("/admin");

  const analystId = context.analystId;
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

  const statusLabelByStatus = Object.fromEntries(
    await Promise.all(Object.entries(STATUS_KEY).map(async ([k, key]) => [k, await t(key)]))
  ) as Record<string, string>;
  const customerCountSuffix = await t("team.page.customer_count_suffix");

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">{await t("team.page.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{await t("team.page.subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard label={await t("team.page.stat.member_count")} value={String(summary.analyst_count)} />
        <StatCard label={await t("team.page.stat.customer_count")} value={String(summary.customer_count)} />
        <StatCard label={await t("team.page.stat.session_count")} value={String(summary.session_count)} />
        <StatCard label="Team Sales" value={formatMYR(summary.total_revenue)} />
        <StatCard label="Team Commission" value={formatMYR(summary.team_commission_total)} />
        <StatCard label={await t("team.page.stat.pending_members")} value={String(summary.pending_team_count)} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("team.page.members_title")}</h2>
        <div className="divide-y rounded-md border">
          {(!members || members.length === 0) && <p className="p-4 text-sm text-muted-foreground">{await t("team.page.empty")}</p>}
          {members?.map((m) => (
            <div key={m.analyst_id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>{m.full_name}</span>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground tabular-nums">
                  {m.customer_count}
                  {customerCountSuffix}
                </span>
                <span className="tabular-nums">{formatMYR(m.revenue)}</span>
                <Badge variant="secondary">{statusLabelByStatus[m.status] ?? m.status}</Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
