"use client";

import { useEffect, useState, useTransition } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  updateAppointmentSchedule,
  cancelAppointment,
  type UpdateAppointmentState,
} from "../customers/children/[id]/schedule/actions";
import { submitWithoutReset } from "@/lib/submit-without-reset";
import type { DeviceScheduleSlot, DeviceOption, CenterOption } from "../_scheduling/data";
import { ct } from "@/lib/i18n-client";

const initialState: UpdateAppointmentState = { status: "idle" };

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit" });
}

function toMYDateString(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

function toMYTimeString(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit" });
}

// Edit/cancel controls for a single booked slot on the general device
// schedule page — scoped to time/device/location only (never the
// customer/analyst, which this page's read model doesn't even expose — see
// listDeviceScheduleForDate()'s header comment). A completed booking (a
// real report already exists) is always shown read-only regardless of role,
// matching the server-side guard in updateAppointmentSchedule/
// cancelAppointment.
export function ScheduleSlotItem({
  slot,
  devices,
  centers,
  canManage,
  boothLabel,
}: {
  slot: DeviceScheduleSlot;
  devices: DeviceOption[];
  centers: CenterOption[];
  canManage: boolean;
  boothLabel: string;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isCancelling, startCancelTransition] = useTransition();
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);
  const boundUpdate = updateAppointmentSchedule.bind(null, slot.appointment_id);
  const [state, formAction, isSaving] = useActionState(boundUpdate, initialState);

  useEffect(() => {
    if (state.status === "success") {
      setIsEditing(false);
      router.refresh();
    }
  }, [state, router]);

  function doCancel() {
    if (!window.confirm(ct("schedule.slot.confirm_cancel_booking"))) return;
    startCancelTransition(async () => {
      const result = await cancelAppointment(slot.appointment_id);
      setCancelMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  const badge = (
    <Badge variant="outline">
      {formatTime(slot.start_at)}–{formatTime(slot.end_at)} · {slot.analyst_name}
      {slot.is_booth ? ` · ${boothLabel}` : ""}
    </Badge>
  );

  const isEditable = slot.status !== "completed";
  if (!canManage || !isEditable) return badge;

  if (isEditing) {
    return (
      <div className="w-full rounded-md border border-dashed p-2">
        <form onSubmit={submitWithoutReset(formAction)} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{ct("schedule.form.device_label")}</label>
            <Select name="device_id" items={devices.map((d) => ({ value: d.id, label: d.label }))} defaultValue={slot.device_id}>
              <SelectTrigger className="w-40">
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
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{ct("schedule.form.location_label")}</label>
            <Select name="center_id" items={centers.map((c) => ({ value: c.id, label: c.name }))} defaultValue={slot.center_id ?? undefined}>
              <SelectTrigger className="w-40">
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
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{ct("schedule.form.date_label")}</label>
            <Input type="date" name="detection_date" defaultValue={toMYDateString(slot.start_at)} className="w-36" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{ct("schedule.form.start_time_label")}</label>
            <Input type="time" name="start_time" defaultValue={toMYTimeString(slot.start_at)} className="w-28" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{ct("schedule.form.end_time_label")}</label>
            <Input type="time" name="end_time" defaultValue={toMYTimeString(slot.end_at)} className="w-28" />
          </div>
          <Button type="submit" size="sm" disabled={isSaving}>
            {ct("schedule.slot.save")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setIsEditing(false)} disabled={isSaving}>
            {ct("schedule.booking.cancel")}
          </Button>
        </form>
        {state.status === "error" && <p className="mt-1 text-xs text-destructive">{state.message}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {badge}
      <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => setIsEditing(true)}>
        {ct("schedule.slot.edit")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 px-1.5 text-xs text-destructive"
        disabled={isCancelling}
        onClick={doCancel}
      >
        {ct("schedule.slot.cancel_booking")}
      </Button>
      {cancelMessage && <span className="text-xs text-muted-foreground">{cancelMessage}</span>}
    </div>
  );
}
