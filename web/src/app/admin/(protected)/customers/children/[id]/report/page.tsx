import { redirect, notFound } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { getChildContext, getLatestOnePageReport } from "./data";
import { t } from "@/lib/i18n";
import { ReportPrintButton } from "./print-button";
import { ReportView } from "./report-view";
import { ReportEntrySection } from "./report-entry-section";
import { listPendingAppointmentsForChild } from "@/app/admin/(protected)/_scheduling/data";

export const dynamic = "force-dynamic";

export default async function ChildReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");

  const child = await getChildContext(id);
  if (!child) notFound();

  const canView = isBackOfficeRole(context) || context.analystId === child.owner_analyst_id;
  if (!canView) redirect("/admin");

  const [report, pendingAppointments] = await Promise.all([getLatestOnePageReport(id), listPendingAppointmentsForChild(id)]);

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
        <ReportPrintButton customerId={child.customer_id} />
      </div>

      {report ? (
        <ReportView child={child} report={report} />
      ) : (
        <p className="print-hidden rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
          {t("tqc.report.no_report_yet")}
        </p>
      )}

      <div className="print-hidden mt-8">
        <h2 className="mb-3 text-sm font-bold tracking-wide text-neutral-500 uppercase">{t("tqc.form.new_assessment_title")}</h2>
        <ReportEntrySection childId={id} scheduleHref={`/admin/customers/children/${id}/schedule`} pendingAppointments={pendingAppointments} />
      </div>
    </div>
  );
}
