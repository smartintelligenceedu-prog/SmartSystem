import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
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

function formatMonth(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

export async function IntroducerSection({ introducerId }: { introducerId: string }) {
  const supabase = await createServerSupabaseClient();

  const [{ data: introducer }, { data: summaryRows }, { data: monthlyRows }, { data: history }] = await Promise.all([
    supabase.from("introducers").select("referral_code").eq("id", introducerId).maybeSingle(),
    supabase.rpc("introducer_summary", { for_introducer_id: introducerId }),
    supabase.rpc("introducer_monthly_summary", { for_introducer_id: introducerId }),
    supabase
      .from("commission_records")
      .select("id, base_amount, rate_applied, commission_amount, calculation_type, status, calculated_at, paid_at")
      .eq("introducer_id", introducerId)
      .order("calculated_at", { ascending: false })
      .limit(20),
  ]);

  const summary = summaryRows?.[0] ?? {
    total_introduced_customers: 0,
    total_bonus: 0,
    pending_bonus: 0,
    paid_bonus: 0,
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">引荐概况（Introducer）</h2>
        {introducer?.referral_code && (
          <p className="text-sm text-muted-foreground">
            我的推荐码：<span className="font-mono font-medium text-foreground">{introducer.referral_code}</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Introduced Customers" value={String(summary.total_introduced_customers)} />
        <StatCard label="Total Bonus" value={formatMYR(summary.total_bonus)} />
        <StatCard label="Pending Bonus" value={formatMYR(summary.pending_bonus)} />
        <StatCard label="Paid Bonus" value={formatMYR(summary.paid_bonus)} />
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">每月介绍统计</h3>
        <div className="divide-y rounded-md border">
          {(!monthlyRows || monthlyRows.length === 0) && <p className="p-4 text-sm text-muted-foreground">暂无纪录</p>}
          {monthlyRows?.map((m: { month: string; new_customers: number; bonus_total: number }) => (
            <div key={m.month} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-muted-foreground">{formatMonth(m.month)}</span>
              <span>新增客户 {m.new_customers} 位</span>
              <span className="tabular-nums font-medium">{formatMYR(m.bonus_total)}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">Bonus History</h3>
        <div className="divide-y rounded-md border">
          {(!history || history.length === 0) && <p className="p-4 text-sm text-muted-foreground">暂无奖金纪录</p>}
          {history?.map((h) => (
            <div key={h.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-muted-foreground tabular-nums">
                {new Date(h.calculated_at).toLocaleDateString("zh-CN")}
              </span>
              <span className="tabular-nums">
                {formatMYR(h.commission_amount)}
                {h.calculation_type === "flat" ? "（固定金额）" : `（${h.rate_applied}% of ${formatMYR(h.base_amount)}）`}
              </span>
              <Badge variant={h.status === "paid" ? "secondary" : "outline"}>
                {h.status === "paid" ? "已发放" : h.status === "pending" ? "待处理" : h.status}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
