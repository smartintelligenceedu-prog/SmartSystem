import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasRole } from "@/lib/auth/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

const STATUS_LABEL: Record<string, string> = {
  pending: "待审核",
  approved: "已核准",
  suspended: "已暂停",
  rejected: "已拒绝",
  terminated: "已终止",
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

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">团队</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          只显示团队汇总数字与成员各自的顾客数/业绩，不显示顾客名单明细——避免上线看到下线经营的顾客资料。你只能看到自己团队，看不到其他 Leader 的资料。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard label="团队人数" value={String(summary.analyst_count)} />
        <StatCard label="团队顾客数" value={String(summary.customer_count)} />
        <StatCard label="团队检测次数" value={String(summary.session_count)} />
        <StatCard label="Team Sales" value={formatMYR(summary.total_revenue)} />
        <StatCard label="Team Commission" value={formatMYR(summary.team_commission_total)} />
        <StatCard label="待审核团队成员" value={String(summary.pending_team_count)} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">团队成员</h2>
        <div className="divide-y rounded-md border">
          {(!members || members.length === 0) && <p className="p-4 text-sm text-muted-foreground">目前没有团队成员</p>}
          {members?.map((m) => (
            <div key={m.analyst_id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>{m.full_name}</span>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground tabular-nums">{m.customer_count} 位顾客</span>
                <span className="tabular-nums">{formatMYR(m.revenue)}</span>
                <Badge variant="secondary">{STATUS_LABEL[m.status] ?? m.status}</Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
