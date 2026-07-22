import { redirect, notFound } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { getCustomerSelfContext, getLatestOnePageReportForCustomerSelf, countAvailableSelfUseVouchers } from "../../children/[id]/report/data";
import { t } from "@/lib/i18n";
import { ReportPrintButton } from "../../children/[id]/report/print-button";
import { ReportView } from "../../children/[id]/report/report-view";
import { ReportEntrySection } from "../../children/[id]/report/report-entry-section";
import { listPendingAppointmentsForCustomerSelf } from "@/app/admin/(protected)/_scheduling/data";

export const dynamic = "force-dynamic";

// Migration 028 — same two-stage report page as the child route, but for a
// customer assessed directly (adult self-assessment), not a child.
export default async function CustomerSelfReportPage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;

  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");

  const subject = await getCustomerSelfContext(customerId);
  if (!subject) notFound();

  const canView = isBackOfficeRole(context) || context.analystId === subject.owner_analyst_id;
  if (!canView) redirect("/admin");

  const [report, pendingAppointments, availableSelfUseVouchers] = await Promise.all([
    getLatestOnePageReportForCustomerSelf(customerId),
    listPendingAppointmentsForCustomerSelf(customerId),
    countAvailableSelfUseVouchers(subject.owner_analyst_id),
  ]);

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
        <ReportPrintButton customerId={customerId} />
      </div>

      {report ? (
        <ReportView child={subject} report={report} />
      ) : (
        <p className="print-hidden rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
          {t("tqc.report.no_report_yet")}
        </p>
      )}

      <div className="print-hidden mt-8">
        <h2 className="mb-3 text-sm font-bold tracking-wide text-neutral-500 uppercase">{t("tqc.form.new_assessment_title")}</h2>
        <ReportEntrySection
          childId={null}
          customerId={customerId}
          scheduleHref={`/admin/customers/${customerId}/self-schedule`}
          pendingAppointments={pendingAppointments}
          availableSelfUseVouchers={availableSelfUseVouchers}
        />
      </div>
    </div>
  );
}
