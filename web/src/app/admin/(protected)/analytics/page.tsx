import { redirect } from "next/navigation";
import Link from "next/link";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasAnyRole } from "@/lib/auth/roles";
import { getFinancialAnalytics, type AnalyticsPeriod } from "./data";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

function MetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}

function monthLabel(month: string) {
  const [year, m] = month.split("-");
  return `${year}/${m}`;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!hasAnyRole(context, ["admin", "finance"])) redirect("/admin");

  const { period: rawPeriod } = await searchParams;
  const period: AnalyticsPeriod = rawPeriod === "quarter" ? "quarter" : "month";

  const analytics = await getFinancialAnalytics(period);
  const { summary, top_institutions, monthly_trend } = analytics;

  const maxTopUsed = Math.max(1, ...top_institutions.map((i) => i.voucher_used));
  const maxTrendValue = Math.max(1, ...monthly_trend.flatMap((p) => [p.order_count, p.voucher_used_count]));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t("analytics.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("analytics.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={period === "month" ? "default" : "outline"} render={<Link href="/admin/analytics?period=month">{t("analytics.period.month")}</Link>} />
          <Button size="sm" variant={period === "quarter" ? "default" : "outline"} render={<Link href="/admin/analytics?period=quarter">{t("analytics.period.quarter")}</Link>} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label={t("analytics.metric.total_revenue")} value={formatMYR(summary.total_revenue)} />
        <MetricCard label={t("analytics.metric.accounts_receivable")} value={formatMYR(summary.accounts_receivable)} note={t("analytics.metric.accounts_receivable_note")} />
        <MetricCard label={t("analytics.metric.recognized_revenue")} value={formatMYR(summary.recognized_revenue)} note={t("analytics.metric.recognized_revenue_note")} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-4 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("analytics.top_institutions.title")}</h2>
          {top_institutions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("analytics.top_institutions.empty")}</p>
          ) : (
            <div className="space-y-3">
              {top_institutions.map((inst) => (
                <div key={inst.institution_name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{inst.institution_name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {t("analytics.top_institutions.used_prefix")} {inst.voucher_used}/{inst.voucher_total}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                    <div
                      className="h-full rounded-full bg-emerald-600"
                      style={{ width: `${Math.max(2, (inst.voucher_used / maxTopUsed) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-4 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("analytics.trend.title")}</h2>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-sky-600" /> {t("analytics.trend.orders_label")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-emerald-600" /> {t("analytics.trend.vouchers_label")}
            </span>
          </div>
          {monthly_trend.every((p) => p.order_count === 0 && p.voucher_used_count === 0) ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("analytics.trend.empty")}</p>
          ) : (
            <div className="mt-4 flex items-end gap-4">
              {monthly_trend.map((p) => (
                <div key={p.month} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-32 items-end gap-1">
                    <div
                      className="w-4 rounded-t bg-sky-600"
                      style={{ height: `${Math.max(2, (p.order_count / maxTrendValue) * 100)}%` }}
                      title={`${p.order_count}`}
                    />
                    <div
                      className="w-4 rounded-t bg-emerald-600"
                      style={{ height: `${Math.max(2, (p.voucher_used_count / maxTrendValue) * 100)}%` }}
                      title={`${p.voucher_used_count}`}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">{monthLabel(p.month)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
