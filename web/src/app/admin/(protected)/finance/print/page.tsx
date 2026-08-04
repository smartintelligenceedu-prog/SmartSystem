import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasAnyRole } from "@/lib/auth/roles";
import { getProfitAndLoss, currentMonth, type AccountBalance } from "../data";
import { getCompanyInfo } from "../../settings/data";
import { t } from "@/lib/i18n";
import { PnlPrintButton } from "./print-button";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-MY", { year: "numeric", month: "long", day: "numeric" });
}

function AccountSection({ title, accounts, total }: { title: string; accounts: AccountBalance[]; total: number }) {
  return (
    <div className="mt-8">
      <h3 className="border-b-2 border-black pb-1 text-sm font-bold tracking-wide uppercase">{title}</h3>
      <table className="mt-2 w-full border-collapse text-sm">
        <tbody>
          {accounts.map((a) => (
            <tr key={a.code} className="border-b border-neutral-200">
              <td className="py-2 text-neutral-600">
                {a.code} {a.name}
              </td>
              <td className="py-2 text-right tabular-nums">{formatMYR(a.balance)}</td>
            </tr>
          ))}
          <tr>
            <td className="pt-2 text-right font-semibold">{title} Total</td>
            <td className="pt-2 text-right font-semibold tabular-nums">{formatMYR(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// Printable A4 Profit & Loss statement — same underlying getProfitAndLoss()
// numbers already shown on the Finance page, just laid out for a physical
// handoff to the company's accountant (e.g. for monthly/yearly bookkeeping),
// mirroring the receipt/institutional-invoice print convention already used
// elsewhere in this module.
export default async function FinancePrintPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!hasAnyRole(context, ["admin", "finance"])) redirect("/admin");

  const { from: fromParam, to: toParam } = await searchParams;
  const fromMonth = fromParam || currentMonth();
  const toMonth = toParam || currentMonth();
  const periodLabel = fromMonth === toMonth ? fromMonth : `${fromMonth} – ${toMonth}`;

  const [pnl, company] = await Promise.all([getProfitAndLoss(fromMonth, toMonth), getCompanyInfo()]);

  return (
    <div className="mx-auto max-w-3xl bg-white text-black print:max-w-none">
      <style>{`
        @page { size: A4; margin: 15mm; }
        @media print {
          .print-hidden { display: none !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="print-hidden mb-6">
        <PnlPrintButton backHref={`/admin/finance?from=${fromMonth}&to=${toMonth}`} />
      </div>

      <div className="relative rounded-md border border-neutral-300 bg-white p-10 print:border-0 print:p-0">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b-4 border-black pb-6">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- static public asset on a print page, next/image's optimizer adds nothing here */}
            <img src="/logo-mark.png" alt="" className="h-16 w-16 shrink-0" />
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">{company.name}</h1>
              <p className="mt-1 text-sm text-neutral-600">{company.addressLine1}</p>
              <p className="text-sm text-neutral-600">{company.addressLine2}</p>
              <p className="mt-1 text-sm text-neutral-600">
                {await t("finance.institutional.print.phone")}: {company.phone}
              </p>
              <p className="text-sm text-neutral-600">{company.email}</p>
              <p className="mt-1 text-sm text-neutral-600">
                {await t("finance.institutional.print.ssm_no")}: {company.ssmNumber}
              </p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <h2 className="text-2xl font-black tracking-wide">{await t("finance.pnl_print.title")}</h2>
            <p className="mt-2 text-sm text-neutral-600">{periodLabel}</p>
          </div>
        </div>

        <AccountSection title={await t("finance.page.revenue_accounts")} accounts={pnl.revenue} total={pnl.totalRevenue} />
        <AccountSection title={await t("finance.page.commission_accounts")} accounts={pnl.commission} total={pnl.totalCommission} />
        <AccountSection title={await t("finance.page.expense_accounts")} accounts={pnl.expense} total={pnl.totalExpense} />

        <div className="mt-8 flex justify-end">
          <div className="w-80 space-y-2 text-sm">
            <div className="flex justify-between border-t-4 border-black pt-2 text-base font-bold">
              <span>{await t("finance.pnl_print.net_profit")}</span>
              <span className="tabular-nums">{formatMYR(pnl.netProfit)}</span>
            </div>
          </div>
        </div>

        <p className="mt-12 text-center text-xs text-neutral-500">
          {await t("finance.pnl_print.generated_note")}
          {formatDate(new Date().toISOString())}
        </p>
      </div>
    </div>
  );
}
