import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AnalystStatus } from "@/lib/types/registration";

export const dynamic = "force-dynamic";

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

async function getDashboardStats() {
  const admin = createAdminClient();

  const [pendingCount, approvedCount, pendingCommission, paidCommission, recent] = await Promise.all([
    admin.from("analysts").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("analysts").select("id", { count: "exact", head: true }).eq("status", "approved"),
    admin.from("commission_records").select("commission_amount").eq("status", "pending"),
    admin.from("commission_records").select("commission_amount").eq("status", "paid"),
    admin.from("analysts").select("id, status, created_at, party_id").order("created_at", { ascending: false }).limit(5),
  ]);

  const pendingCommissionTotal = (pendingCommission.data ?? []).reduce((sum, r) => sum + Number(r.commission_amount), 0);
  const paidCommissionTotal = (paidCommission.data ?? []).reduce((sum, r) => sum + Number(r.commission_amount), 0);

  const recentPartyIds = (recent.data ?? []).map((r) => r.party_id);
  const { data: identities } = await admin.from("individuals").select("party_id, full_name").in("party_id", recentPartyIds.length > 0 ? recentPartyIds : ["00000000-0000-0000-0000-000000000000"]);
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));

  return {
    pendingCount: pendingCount.count ?? 0,
    approvedCount: approvedCount.count ?? 0,
    pendingCommissionTotal,
    paidCommissionTotal,
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

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="待审核申请" value={String(stats.pendingCount)} href="/admin/registrations?status=pending" />
        <StatCard label="已核准分析师" value={String(stats.approvedCount)} href="/admin/registrations?status=approved" />
        <StatCard label="待结算佣金" value={formatMYR(stats.pendingCommissionTotal)} />
        <StatCard label="已发放佣金" value={formatMYR(stats.paidCommissionTotal)} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">最新申请</h2>
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
    </div>
  );
}
