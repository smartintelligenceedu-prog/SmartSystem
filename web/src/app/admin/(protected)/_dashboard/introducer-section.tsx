import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CopyLinkButton } from "../_components/copy-link-button";
import { t, getServerLocale } from "@/lib/i18n";

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

function formatMonth(dateStr: string, locale: "zh" | "en") {
  const d = new Date(dateStr);
  if (locale === "en") {
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short" });
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

export async function IntroducerSection({ introducerId }: { introducerId: string }) {
  const supabase = await createServerSupabaseClient();

  const [{ data: introducer }, { data: summaryRows }, { data: monthlyRows }, { data: history }] = await Promise.all([
    supabase.from("introducers").select("referral_code, assigned_analyst_id").eq("id", introducerId).maybeSingle(),
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

  const [
    title,
    referralCodePrefix,
    copyLinkLabel,
    noAnalystNote,
    statTotalIntroducedCustomers,
    statTotalBonus,
    statPendingBonus,
    statPaidBonus,
    monthlyStatsTitle,
    emptyMonthly,
    newCustomersPrefix,
    newCustomersSuffix,
    bonusHistoryTitle,
    emptyBonus,
    flatAmount,
    ratePrefix,
    percentOf,
    rateSuffix,
    statusPaid,
    statusPending,
  ] = await Promise.all([
    t("dashboard.introducer.title"),
    t("dashboard.introducer.referral_code_prefix"),
    t("dashboard.introducer.copy_link"),
    t("dashboard.introducer.no_analyst_note"),
    t("dashboard.introducer.stat.total_introduced_customers"),
    t("dashboard.introducer.stat.total_bonus"),
    t("dashboard.introducer.stat.pending_bonus"),
    t("dashboard.introducer.stat.paid_bonus"),
    t("dashboard.introducer.monthly_stats_title"),
    t("dashboard.introducer.empty_monthly"),
    t("dashboard.introducer.new_customers_prefix"),
    t("dashboard.introducer.new_customers_suffix"),
    t("dashboard.introducer.bonus_history_title"),
    t("dashboard.introducer.empty_bonus"),
    t("dashboard.introducer.flat_amount"),
    t("dashboard.introducer.rate_prefix"),
    t("dashboard.introducer.percent_of"),
    t("dashboard.introducer.rate_suffix"),
    t("commission.status.paid"),
    t("commission.status.pending"),
  ]);
  const locale = await getServerLocale();

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
        {introducer?.referral_code && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">
              {referralCodePrefix}<span className="font-mono font-medium text-foreground">{introducer.referral_code}</span>
            </p>
            <CopyLinkButton path={`/refer/${introducer.referral_code}`} label={copyLinkLabel} />
          </div>
        )}
      </div>
      {introducer?.referral_code && !introducer.assigned_analyst_id && (
        <p className="text-xs text-muted-foreground">{noAnalystNote}</p>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label={statTotalIntroducedCustomers} value={String(summary.total_introduced_customers)} />
        <StatCard label={statTotalBonus} value={formatMYR(summary.total_bonus)} />
        <StatCard label={statPendingBonus} value={formatMYR(summary.pending_bonus)} />
        <StatCard label={statPaidBonus} value={formatMYR(summary.paid_bonus)} />
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{monthlyStatsTitle}</h3>
        <div className="divide-y rounded-md border">
          {(!monthlyRows || monthlyRows.length === 0) && <p className="p-4 text-sm text-muted-foreground">{emptyMonthly}</p>}
          {monthlyRows?.map((m: { month: string; new_customers: number; bonus_total: number }) => (
            <div key={m.month} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-muted-foreground">{formatMonth(m.month, locale)}</span>
              <span>{newCustomersPrefix}{m.new_customers}{newCustomersSuffix}</span>
              <span className="tabular-nums font-medium">{formatMYR(m.bonus_total)}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{bonusHistoryTitle}</h3>
        <div className="divide-y rounded-md border">
          {(!history || history.length === 0) && <p className="p-4 text-sm text-muted-foreground">{emptyBonus}</p>}
          {history?.map((h) => (
            <div key={h.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-muted-foreground tabular-nums">
                {new Date(h.calculated_at).toLocaleDateString("zh-CN")}
              </span>
              <span className="tabular-nums">
                {formatMYR(h.commission_amount)}
                {h.calculation_type === "flat" ? flatAmount : `${ratePrefix}${h.rate_applied}${percentOf}${formatMYR(h.base_amount)}${rateSuffix}`}
              </span>
              <Badge variant={h.status === "paid" ? "secondary" : "outline"}>
                {h.status === "paid" ? statusPaid : h.status === "pending" ? statusPending : h.status}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
