import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { currentMonth } from "../../finance/data";
import { listAnalystMonthlySummary, listIntroducerMonthlySummary } from "./data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MonthPicker } from "./month-picker";
import { BreakdownToggle } from "./breakdown-toggle";
import { t, type TranslationKey } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

const TRIGGER_KEY = {
  personal_sale: "payroll.trigger_type.personal_sale",
  pic_channel: "payroll.trigger_type.pic_channel",
  introducer: "payroll.trigger_type.introducer",
  recruitment: "payroll.trigger_type.recruitment",
  voucher_resale: "payroll.trigger_type.voucher_resale",
  report_override: "payroll.trigger_type.report_override",
  analyst_report_fee: "payroll.trigger_type.analyst_report_fee",
  package_deposit_commission: "payroll.trigger_type.package_deposit_commission",
} satisfies Record<string, TranslationKey>;

async function resolveTriggerLabels(): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(Object.entries(TRIGGER_KEY).map(async ([k, tk]) => [k, await t(tk)])));
}

// "YYYY-MM" -> inclusive first/last day, "YYYY-MM-DD" each — the contract
// listAllCommissions() / listPaidSaleItemsInRange() both already expect.
function monthToRange(month: string): { dateFrom: string; dateTo: string } {
  const [y, m] = month.split("-").map(Number);
  const dateFrom = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const dateTo = `${month}-${String(lastDay).padStart(2, "0")}`;
  return { dateFrom, dateTo };
}

export default async function CommissionSummaryPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!isBackOfficeRole(context)) redirect("/admin/commission");

  const { month: monthParam } = await searchParams;
  const month = monthParam || currentMonth();
  const { dateFrom, dateTo } = monthToRange(month);

  const [analystRows, introducerRows, triggerLabelByType] = await Promise.all([
    listAnalystMonthlySummary(dateFrom, dateTo),
    listIntroducerMonthlySummary(dateFrom, dateTo),
    resolveTriggerLabels(),
  ]);

  const analystSalesTotal = analystRows.reduce((sum, r) => sum + r.total_sales, 0);
  const analystCommissionTotal = analystRows.reduce((sum, r) => sum + r.total_commission, 0);
  const introducerSalesTotal = introducerRows.reduce((sum, r) => sum + r.total_sales, 0);
  const introducerCommissionTotal = introducerRows.reduce((sum, r) => sum + r.total_commission, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{await t("commission.summary.page.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{await t("commission.summary.page.subtitle")}</p>
        </div>
        <MonthPicker month={month} />
      </div>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">{await t("commission.summary.section.analysts")}</h2>
          <p className="text-sm text-muted-foreground">
            {await t("commission.summary.total_sales_prefix")}
            {formatMYR(analystSalesTotal)}
            {" · "}
            {await t("commission.summary.total_commission_prefix")}
            {formatMYR(analystCommissionTotal)}
          </p>
        </div>
        <div className="overflow-x-auto rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{await t("commission.summary.column.name")}</TableHead>
                <TableHead>{await t("commission.summary.column.sales")}</TableHead>
                <TableHead>{await t("commission.summary.column.commission")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analystRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    {await t("commission.summary.empty")}
                  </TableCell>
                </TableRow>
              )}
              {analystRows.map((r) => (
                <TableRow key={r.analyst_id}>
                  <TableCell>
                    <BreakdownToggle name={r.name} breakdown={r.breakdown} triggerLabelByType={triggerLabelByType} />
                  </TableCell>
                  <TableCell className="tabular-nums">{formatMYR(r.total_sales)}</TableCell>
                  <TableCell className="tabular-nums font-medium">{formatMYR(r.total_commission)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">{await t("commission.summary.section.introducers")}</h2>
          <p className="text-sm text-muted-foreground">
            {await t("commission.summary.total_sales_prefix")}
            {formatMYR(introducerSalesTotal)}
            {" · "}
            {await t("commission.summary.total_commission_prefix")}
            {formatMYR(introducerCommissionTotal)}
          </p>
        </div>
        <div className="overflow-x-auto rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{await t("commission.summary.column.name")}</TableHead>
                <TableHead>{await t("commission.summary.column.referred_sales")}</TableHead>
                <TableHead>{await t("commission.summary.column.commission")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {introducerRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    {await t("commission.summary.empty")}
                  </TableCell>
                </TableRow>
              )}
              {introducerRows.map((r) => (
                <TableRow key={r.introducer_id}>
                  <TableCell>
                    <BreakdownToggle name={r.name} breakdown={r.breakdown} triggerLabelByType={triggerLabelByType} />
                  </TableCell>
                  <TableCell className="tabular-nums">{formatMYR(r.total_sales)}</TableCell>
                  <TableCell className="tabular-nums font-medium">{formatMYR(r.total_commission)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
