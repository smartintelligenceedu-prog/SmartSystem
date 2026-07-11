import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">团队管理（Leader）</h2>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Team Summary（团队人数）" value={String(summary.analyst_count)} />
        <StatCard label="Team Sales" value={formatMYR(summary.total_revenue)} />
        <StatCard label="Team Commission" value={formatMYR(summary.team_commission_total)} />
        <StatCard label="Override Summary（我的佣金）" value={formatMYR(overrideSummary)} />
        <StatCard label="Pending Team Approval" value={String(summary.pending_team_count)} />
      </div>
      <p className="text-xs text-muted-foreground">
        团队汇总只显示数字，不显示团队成员各自的顾客名单明细——这是刻意的设计，避免上线看到下线经营的顾客资料。
      </p>

      <div>
        <h3 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">Team Performance</h3>
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
    </section>
  );
}
