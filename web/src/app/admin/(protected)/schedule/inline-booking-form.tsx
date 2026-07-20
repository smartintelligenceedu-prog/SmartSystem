"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ct } from "@/lib/i18n-client";
import { scheduleAppointment, type ScheduleAppointmentState } from "../customers/children/[id]/schedule/actions";
import type { CenterOption, DeviceOption, CustomerChildOption } from "../_scheduling/data";

const initialState: ScheduleAppointmentState = { status: "idle" };

const SELF_VALUE = "__self__";

function todayDateString() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

export function InlineBookingForm({
  customers,
  centers,
  devices,
}: {
  customers: CustomerChildOption[];
  centers: CenterOption[];
  devices: DeviceOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [subjectValue, setSubjectValue] = useState<string | null>(null);
  const [state, formAction, isPending] = useActionState(scheduleAppointment, initialState);

  useEffect(() => {
    if (state.status === "success") {
      setOpen(false);
      setCustomerId(null);
      setSubjectValue(null);
      router.refresh();
    }
  }, [state, router]);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm">
        {ct("schedule.booking.toggle")}
      </Button>
    );
  }

  const selectedCustomer = customers.find((c) => c.customer_id === customerId);

  return (
    <Card>
      <CardContent className="pt-6">
        {customers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{ct("schedule.booking.no_customers")}</p>
        ) : (
          <form action={formAction} className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="customer_select">{ct("schedule.booking.customer_label")}</Label>
                <Select
                  items={customers.map((c) => ({ value: c.customer_id, label: c.customer_name }))}
                  value={customerId ?? undefined}
                  onValueChange={(v) => {
                    setCustomerId(v as string);
                    setSubjectValue(null);
                  }}
                >
                  <SelectTrigger id="customer_select" className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.customer_id} value={c.customer_id}>
                        {c.customer_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="child_select">{ct("schedule.booking.child_label")}</Label>
                <Select
                  key={customerId ?? "none"}
                  value={subjectValue ?? undefined}
                  onValueChange={(v) => setSubjectValue(v as string)}
                  disabled={!selectedCustomer}
                >
                  <SelectTrigger id="child_select" className="w-full">
                    <SelectValue placeholder={selectedCustomer ? "—" : ct("schedule.booking.select_customer_first")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELF_VALUE}>{ct("schedule.booking.self_option")}</SelectItem>
                    {(selectedCustomer?.children ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input type="hidden" name="child_id" value={subjectValue && subjectValue !== SELF_VALUE ? subjectValue : ""} />
                <input type="hidden" name="customer_id" value={selectedCustomer?.customer_id ?? ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="center_id">{ct("schedule.form.location_label")}</Label>
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
                <Label htmlFor="device_id">{ct("schedule.form.device_label")}</Label>
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
            </div>

            <div className="grid grid-cols-3 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="detection_date">{ct("schedule.form.date_label")}</Label>
                <Input id="detection_date" name="detection_date" type="date" defaultValue={todayDateString()} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="start_time">{ct("schedule.form.start_time_label")}</Label>
                <Input id="start_time" name="start_time" type="time" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_time">{ct("schedule.form.end_time_label")}</Label>
                <Input id="end_time" name="end_time" type="time" required />
              </div>
            </div>

            {state.status === "error" && (
              <p className="text-sm text-destructive" role="alert">
                {state.message}
              </p>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={isPending || !selectedCustomer || !subjectValue}>
                {ct("schedule.form.submit")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
                {ct("schedule.booking.cancel")}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
