"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ct } from "@/lib/i18n-client";
import { ReportForm } from "./report-form";
import type { PendingAppointment } from "@/app/admin/(protected)/_scheduling/data";

function formatSlot(a: PendingAppointment) {
  const start = new Date(a.scheduled_at);
  const end = new Date(start.getTime() + a.duration_minutes * 60000);
  const dateLabel = start.toLocaleDateString("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "2-digit", year: "numeric" });
  const startLabel = start.toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit" });
  const endLabel = end.toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit" });
  return `${a.device_label} · ${a.center_name} · ${dateLabel} ${startLabel}-${endLabel}`;
}

export function ReportEntrySection({
  childId,
  customerId,
  scheduleHref,
  pendingAppointments,
}: {
  childId: string | null;
  customerId?: string;
  scheduleHref: string;
  pendingAppointments: PendingAppointment[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(pendingAppointments.length === 1 ? pendingAppointments[0].appointment_id : null);

  if (pendingAppointments.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6 text-center">
          <p className="text-sm text-muted-foreground">{ct("tqc.form.no_pending_appointment")}</p>
          <Button size="sm" render={<Link href={scheduleHref}>{ct("tqc.form.schedule_link")}</Link>} />
        </CardContent>
      </Card>
    );
  }

  const selected = pendingAppointments.find((a) => a.appointment_id === selectedId);

  return (
    <div className="space-y-4">
      {!selected && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("tqc.form.pending_appointments_title")}</p>
            <div className="divide-y rounded-md border">
              {pendingAppointments.map((a) => (
                <button
                  key={a.appointment_id}
                  type="button"
                  onClick={() => setSelectedId(a.appointment_id)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-accent/50"
                >
                  <span>{formatSlot(a)}</span>
                  <span className="text-primary underline">{ct("tqc.form.enter_result_button")}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {selected && (
        <ReportForm childId={childId} customerId={customerId} appointmentId={selected.appointment_id} appointmentSummary={formatSlot(selected)} />
      )}

      <div className="text-right">
        <Button size="sm" variant="ghost" render={<Link href={scheduleHref}>{ct("tqc.form.schedule_link")}</Link>} />
      </div>
    </div>
  );
}
