import { redirect, notFound } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { getStaffPayslipDetail } from "../../data";
import { getCompanyInfo } from "../../../settings/data";
import { t } from "@/lib/i18n";
import { PayrollPrintButton } from "../../print-button";
import { Logo } from "@/components/logo";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-MY", { year: "numeric", month: "long", day: "numeric" });
}

export default async function StaffPayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");

  const payslip = await getStaffPayslipDetail(id);
  if (!payslip) notFound();

  const canView = isBackOfficeRole(context) || context.partyId === payslip.party_id;
  if (!canView) redirect("/admin/payroll");

  const ISSUER = await getCompanyInfo();

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
        <PayrollPrintButton />
      </div>

      <div className="rounded-md border border-neutral-300 bg-white p-10 print:border-0 print:p-0">
        <div className="flex items-start justify-between border-b-4 border-black pb-6">
          <div>
            <Logo className="mb-2 w-40" />
            <p className="text-sm text-neutral-600">{ISSUER.name}</p>
          </div>
          <div className="text-right">
            <h1 className="text-2xl font-extrabold tracking-tight">{t("payroll.staff.payslip_title")}</h1>
            <p className="mt-1 text-sm text-neutral-600">{payslip.full_name}</p>
            <p className="mt-2 text-sm text-neutral-600">
              {t("payroll.payslip.period_label")}: {formatDate(payslip.period_start)} – {formatDate(payslip.period_end)}
            </p>
          </div>
        </div>

        <table className="mt-8 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-black">
              <th className="py-2 text-left font-bold">{t("payroll.line_item.description")}</th>
              <th className="py-2 text-right font-bold">{t("payroll.line_item.amount")}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-200">
              <td className="py-3">{payslip.description || t("payroll.staff.payslip_title")}</td>
              <td className="py-3 text-right tabular-nums">{formatMYR(payslip.gross_amount)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-6 flex justify-end">
          <div className="w-64 space-y-2 text-sm">
            <div className="flex justify-between border-t-2 border-black pt-2 text-base font-bold">
              <span>{t("payroll.payslip.gross_total_label")}</span>
              <span className="tabular-nums">{formatMYR(payslip.gross_amount)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
