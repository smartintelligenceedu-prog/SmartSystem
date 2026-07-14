import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { getChildContext } from "../report/data";
import { listActiveCenters, listActiveDevices } from "@/app/admin/(protected)/_scheduling/data";
import { t } from "@/lib/i18n";
import { ScheduleForm } from "./schedule-form";

export const dynamic = "force-dynamic";

export default async function ScheduleAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");

  const child = await getChildContext(id);
  if (!child) notFound();

  const canView = isBackOfficeRole(context) || context.analystId === child.owner_analyst_id;
  if (!canView) redirect("/admin");

  const [centers, devices] = await Promise.all([listActiveCenters(), listActiveDevices()]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t("schedule.appointment.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{child.child_name}</p>
        </div>
        <Link href={`/admin/customers/children/${id}/report`} className="text-sm text-primary underline">
          {t("schedule.appointment.back_to_report")}
        </Link>
      </div>

      <ScheduleForm childId={id} centers={centers} devices={devices} />
    </div>
  );
}
