import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { getPayoutRunDetail } from "../../data";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-MY", { year: "numeric", month: "long", day: "numeric" });
}

export default async function PayoutRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!isBackOfficeRole(context)) redirect("/admin/payroll");

  const run = await getPayoutRunDetail(id);
  if (!run) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t("payroll.run_detail.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatDate(run.period_start)} – {formatDate(run.period_end)}
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("payroll.run_detail.analyst_section")}</p>
          {run.analyst_lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("payroll.run_detail.empty")}</p>
          ) : (
            <div className="divide-y">
              {run.analyst_lines.map((l) => (
                <div key={l.payslip_id} className="flex items-center justify-between py-3 text-sm">
                  <span>{l.analyst_name}</span>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums font-medium">{formatMYR(l.gross_amount)}</span>
                    <Button size="sm" variant="ghost" render={<Link href={`/admin/payroll/payslip/${l.payslip_id}`}>{t("payroll.view_detail_link")}</Link>} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("payroll.run_detail.introducer_section")}</p>
          {run.introducer_lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("payroll.run_detail.empty")}</p>
          ) : (
            <div className="divide-y">
              {run.introducer_lines.map((l) => (
                <div key={l.statement_id} className="flex items-center justify-between py-3 text-sm">
                  <span>{l.introducer_name}</span>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums font-medium">{formatMYR(l.gross_amount)}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      render={<Link href={`/admin/payroll/statement/${l.statement_id}`}>{t("payroll.view_detail_link")}</Link>}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
