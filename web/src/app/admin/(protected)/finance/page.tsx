import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasAnyRole } from "@/lib/auth/roles";
import { getUnpostedSummary, getProfitAndLossThisMonth, listRecentJournalEntries, getReportDeliverySummaryThisMonth } from "./data";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PostToLedgerButton } from "./post-to-ledger-button";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

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

export default async function FinancePage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!hasAnyRole(context, ["admin", "finance"])) redirect("/admin");

  const [unposted, pnl, recentEntries, reportSummary] = await Promise.all([
    getUnpostedSummary(),
    getProfitAndLossThisMonth(),
    listRecentJournalEntries(),
    getReportDeliverySummaryThisMonth(),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">财务</h1>
          <p className="mt-1 text-sm text-muted-foreground">总帐（Chart of Accounts）与本月损益。</p>
        </div>
        <Button size="sm" variant="secondary" render={<Link href="/admin/finance/institutional">{t("finance.institutional.nav_link")}</Link>} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <div>
            <p className="text-sm font-medium">待过帐交易</p>
            <p className="text-sm text-muted-foreground">
              {unposted.unpostedOrderCount} 笔已付款订单、{unposted.unpostedCommissionCount} 笔佣金记录尚未过帐
            </p>
          </div>
          <PostToLedgerButton unpostedCount={unposted.unpostedOrderCount + unposted.unpostedCommissionCount} />
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">本月损益（依据已过帐总帐资料）</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <StatCard label="Total Revenue" value={formatMYR(pnl.totalRevenue)} />
          <StatCard label="Total Commission" value={formatMYR(pnl.totalExpense)} />
          <StatCard label="Net Profit" value={formatMYR(pnl.netProfit)} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          这个数字只算已过帐的交易，跟 Dashboard 上「简化估算」的 Net Profit 在完全过帐前可能会不一致——过帐后两者会趋于一致。
        </p>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("finance.report_summary.title")}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label={t("finance.report_summary.total")} value={String(reportSummary.totalCount)} />
          <StatCard label={t("finance.report_summary.standard")} value={String(reportSummary.standardCount)} />
          <StatCard label={t("finance.report_summary.upgrade")} value={String(reportSummary.upgradeCount)} />
          <StatCard label={t("finance.report_summary.total_cost")} value={formatMYR(reportSummary.totalCost)} />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">收入科目</h3>
          <div className="divide-y rounded-md border">
            {pnl.revenue.map((a) => (
              <div key={a.code} className="flex justify-between px-3 py-2 text-sm">
                <span className="text-muted-foreground">{a.code} {a.name}</span>
                <span className="tabular-nums">{formatMYR(a.balance)}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">支出科目</h3>
          <div className="divide-y rounded-md border">
            {pnl.expense.map((a) => (
              <div key={a.code} className="flex justify-between px-3 py-2 text-sm">
                <span className="text-muted-foreground">{a.code} {a.name}</span>
                <span className="tabular-nums">{formatMYR(a.balance)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">最近过帐记录</h2>
        <div className="divide-y rounded-md border">
          {recentEntries.length === 0 && <p className="p-4 text-sm text-muted-foreground">尚无过帐记录</p>}
          {recentEntries.map((e) => (
            <div key={e.id} className="px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span>{e.description}</span>
                <span className="text-muted-foreground tabular-nums">{new Date(e.entry_date).toLocaleDateString("zh-CN")}</span>
              </div>
              {e.lines.map((l, i) => (
                <div key={i} className="flex justify-between text-xs text-muted-foreground">
                  <span>{l.account_code} {l.account_name}</span>
                  <span className="tabular-nums">
                    {l.debit > 0 ? `借 ${formatMYR(l.debit)}` : `贷 ${formatMYR(l.credit)}`}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
