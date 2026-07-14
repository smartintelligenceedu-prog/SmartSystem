"use client";

import { useActionState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/lib/i18n";
import { scheduleAppointment, type ScheduleAppointmentState } from "./actions";
import type { CenterOption, DeviceOption } from "@/app/admin/(protected)/_scheduling/data";

const initialState: ScheduleAppointmentState = { status: "idle" };

function todayDateString() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

export function ScheduleForm({
  childId,
  customerId,
  centers,
  devices,
}: {
  childId: string | null;
  customerId?: string;
  centers: CenterOption[];
  devices: DeviceOption[];
}) {
  const [state, formAction, isPending] = useActionState(scheduleAppointment, initialState);

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-4">
          {childId ? <input type="hidden" name="child_id" value={childId} /> : <input type="hidden" name="customer_id" value={customerId} />}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="center_id">{t("schedule.form.location_label")}</Label>
              <Select name="center_id" items={centers.map((c) => ({ value: c.id, label: c.name }))}>
                <SelectTrigger id="center_id" className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {centers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="device_id">{t("schedule.form.device_label")}</Label>
              <Select name="device_id" items={devices.map((d) => ({ value: d.id, label: d.label }))}>
                <SelectTrigger id="device_id" className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {devices.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="detection_date">{t("schedule.form.date_label")}</Label>
              <Input id="detection_date" name="detection_date" type="date" defaultValue={todayDateString()} required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="start_time">{t("schedule.form.start_time_label")}</Label>
                <Input id="start_time" name="start_time" type="time" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_time">{t("schedule.form.end_time_label")}</Label>
                <Input id="end_time" name="end_time" type="time" required />
              </div>
            </div>
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "success" && <p className="text-sm">{t("schedule.form.success")}</p>}

          <Button type="submit" disabled={isPending}>
            {t("schedule.form.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
