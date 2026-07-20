import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasAnyRole } from "@/lib/auth/roles";
import {
  getUnpostedSummary,
  listUnpostedTransactions,
  getProfitAndLoss,
  listJournalEntriesForMonth,
  getReportDeliverySummary,
  currentMonth,
} from "./data";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PostToLedgerButton } from "./post-to-ledger-button";
import { UnpostedTransactionsList } from "./unposted-transactions-list";
import { RecordExpenseForm } from "./record-expense-form";
import { MonthPicker } from "./month-picker";
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

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!hasAnyRole(context, ["admin", "finance"])) redirect("/admin");

  const { month: monthParam } = await searchParams;
  const month = monthParam || currentMonth();
  const isCurrentMonth = month === currentMonth();

  const [unposted, unpostedTransactions, pnl, recentEntries, reportSummary] = await Promise.all([
    getUnpostedSummary(),
    listUnpostedTransactions(),
    getProfitAndLoss(month),
    listJournalEntriesForMonth(month),
    getReportDeliverySummary(month),
  ]);
  const debitPrefix = await t("finance.page.debit_prefix");
  const creditPrefix = await t("finance.page.credit_prefix");

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{await t("finance.page.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{await t("finance.page.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthPicker month={month} />
          <Button size="sm" variant="secondary" render={<Link href="/admin/finance/institutional">{await t("finance.institutional.nav_link")}</Link>} />
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <div>
            <p className="text-sm font-medium">{await t("finance.page.unposted_title")}</p>
            <p className="text-sm text-muted-foreground">
              {unposted.unpostedOrderCount}
              {await t("finance.page.unposted_orders_suffix")}
              {unposted.unpostedCommissionCount}
              {await t("finance.page.unposted_commissions_suffix")}
            </p>
          </div>
          <PostToLedgerButton unpostedCount={unposted.unpostedOrderCount + unposted.unpostedCommissionCount} />
        </CardContent>
      </Card>

      {unpostedTransactions.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("finance.page.unposted_detail_title")}</h2>
          <UnpostedTransactionsList transactions={unpostedTransactions} />
        </div>
      )}

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("finance.page.company_expense_title")}</h2>
        <RecordExpenseForm />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">
          {month}
          {await t("finance.page.pnl_title_suffix")}
          {!isCurrentMonth && <span className="ml-2 text-primary normal-case">{await t("finance.page.not_current_month")}</span>}
        </h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <StatCard label="Total Revenue" value={formatMYR(pnl.totalRevenue)} />
          <StatCard label="Total Expense" value={formatMYR(pnl.totalExpense)} />
          <StatCard label="Net Profit" value={formatMYR(pnl.netProfit)} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{await t("finance.page.pnl_note")}</p>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("finance.report_summary.title")}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label={await t("finance.report_summary.total")} value={String(reportSummary.totalCount)} />
          <StatCard label={await t("finance.report_summary.standard")} value={String(reportSummary.standardCount)} />
          <StatCard label={await t("finance.report_summary.upgrade")} value={String(reportSummary.upgradeCount)} />
          <StatCard label={await t("finance.report_summary.total_cost")} value={formatMYR(reportSummary.totalCost)} />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{await t("finance.page.revenue_accounts")}</h3>
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
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{await t("finance.page.expense_accounts")}</h3>
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
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("finance.page.recent_entries")}</h2>
        <div className="divide-y rounded-md border">
          {recentEntries.length === 0 && <p className="p-4 text-sm text-muted-foreground">{await t("finance.page.no_entries")}</p>}
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
                    {l.debit > 0 ? `${debitPrefix}${formatMYR(l.debit)}` : `${creditPrefix}${formatMYR(l.credit)}`}
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
