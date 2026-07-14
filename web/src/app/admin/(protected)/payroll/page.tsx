import { redirect } from "next/navigation";
import Link from "next/link";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasAnyRole } from "@/lib/auth/roles";
import { listPayoutRuns, listAnalystPayslips, listIntroducerStatements } from "./data";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { RunPayoutForm } from "./run-payout-form";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-MY", { year: "numeric", month: "long", day: "numeric" });
}

export default async function PayrollPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");

  const isFinance = hasAnyRole(context, ["admin", "finance"]);
  const hasAnalyst = !!context.analystId;
  const hasIntroducer = !!context.introducerId;

  if (!isFinance && !hasAnalyst && !hasIntroducer) redirect("/admin");

  const [runs, payslips, statements] = await Promise.all([
    isFinance ? listPayoutRuns() : Promise.resolve([]),
    hasAnalyst ? listAnalystPayslips(context.analystId!) : Promise.resolve([]),
    hasIntroducer ? listIntroducerStatements(context.introducerId!) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">{t("payroll.title")}</h1>

      {isFinance && (
        <>
          <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("payroll.run.section_title")}</h2>
          <RunPayoutForm />

          <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("payroll.run.history_title")}</h2>
          <Card>
            <CardContent className="pt-6">
              {runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("payroll.run.history_empty")}</p>
              ) : (
                <div className="divide-y">
                  {runs.map((r) => (
                    <div key={r.id} className="flex items-center justify-between py-3 text-sm">
                      <span>
                        {formatDate(r.period_start)} – {formatDate(r.period_end)}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="tabular-nums text-muted-foreground">
                          {t("payroll.run.analyst_total_label")} {formatMYR(r.analyst_payout_total)} · {t("payroll.run.introducer_total_label")}{" "}
                          {formatMYR(r.introducer_payout_total)}
                        </span>
                        <Button size="sm" variant="ghost" render={<Link href={`/admin/payroll/run/${r.id}`}>{t("payroll.view_detail_link")}</Link>} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {hasAnalyst && (
        <>
          <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("payroll.my_payslips.title")}</h2>
          <Card>
            <CardContent className="pt-6">
              {payslips.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("payroll.my_payslips.empty")}</p>
              ) : (
                <div className="divide-y">
                  {payslips.map((p) => (
                    <div key={p.id} className="flex items-center justify-between py-3 text-sm">
                      <span>
                        {formatDate(p.period_start)} – {formatDate(p.period_end)}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="tabular-nums font-medium">{formatMYR(p.gross_amount)}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          render={<Link href={`/admin/payroll/payslip/${p.id}`}>{t("payroll.view_detail_link")}</Link>}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {hasIntroducer && (
        <>
          <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("payroll.my_statements.title")}</h2>
          <Card>
            <CardContent className="pt-6">
              {statements.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("payroll.my_statements.empty")}</p>
              ) : (
                <div className="divide-y">
                  {statements.map((s) => (
                    <div key={s.id} className="flex items-center justify-between py-3 text-sm">
                      <span>
                        {formatDate(s.period_start)} – {formatDate(s.period_end)}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="tabular-nums font-medium">{formatMYR(s.gross_amount)}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          render={<Link href={`/admin/payroll/statement/${s.id}`}>{t("payroll.view_detail_link")}</Link>}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
