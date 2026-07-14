import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listDeviceScheduleForDate } from "@/app/admin/(protected)/_scheduling/data";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit" });
}

function todayDateString() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!context.analystId && !isBackOfficeRole(context)) redirect("/admin");

  const { date } = await searchParams;
  const selectedDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayDateString();

  const groups = await listDeviceScheduleForDate(selectedDate);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t("schedule.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("schedule.subtitle")}</p>
      </div>

      <form className="flex items-end gap-2">
        <div className="space-y-2">
          <label htmlFor="date" className="text-xs text-muted-foreground">
            {t("schedule.date_label")}
          </label>
          <Input id="date" type="date" name="date" defaultValue={selectedDate} className="w-40" />
        </div>
        <Button type="submit" size="sm">
          {t("schedule.filter_button")}
        </Button>
      </form>

      {groups.length === 0 && <p className="text-sm text-muted-foreground">{t("schedule.no_devices")}</p>}

      <div className="space-y-3">
        {groups.map((g) => (
          <Card key={g.device_id}>
            <CardContent className="pt-6">
              <p className="font-medium">{g.device_label}</p>
              {g.slots.length === 0 ? (
                <p className="mt-2 text-sm text-emerald-700">{t("schedule.free_all_day")}</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {g.slots.map((s) => (
                    <Badge key={s.appointment_id} variant="outline">
                      {formatTime(s.start_at)}–{formatTime(s.end_at)} · {s.analyst_name}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
