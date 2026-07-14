import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { getCustomerSelfContext } from "../../children/[id]/report/data";
import { listActiveCenters, listActiveDevices } from "@/app/admin/(protected)/_scheduling/data";
import { t } from "@/lib/i18n";
import { ScheduleForm } from "../../children/[id]/schedule/schedule-form";

export const dynamic = "force-dynamic";

// Migration 028 — same Stage 1 booking form as the child route, but for a
// customer assessed directly (adult self-assessment), not a child.
export default async function CustomerSelfSchedulePage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;

  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");

  const subject = await getCustomerSelfContext(customerId);
  if (!subject) notFound();

  const canView = isBackOfficeRole(context) || context.analystId === subject.owner_analyst_id;
  if (!canView) redirect("/admin");

  const [centers, devices] = await Promise.all([listActiveCenters(), listActiveDevices()]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t("schedule.appointment.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subject.customer_name}</p>
        </div>
        <Link href={`/admin/customers/${customerId}/self-report`} className="text-sm text-primary underline">
          {t("schedule.appointment.back_to_report")}
        </Link>
      </div>

      <ScheduleForm childId={null} customerId={customerId} centers={centers} devices={devices} />
    </div>
  );
}
