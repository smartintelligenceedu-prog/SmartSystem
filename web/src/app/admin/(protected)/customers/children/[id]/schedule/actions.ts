"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChildContext, getCustomerSelfContext } from "../report/data";
import { t } from "@/lib/i18n";

async function requireCallerContext(): Promise<{ analystId: string | null; isBackOffice: boolean } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "请先登入" };

  const { data: userRow } = await supabase.from("users").select("id, party_id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: "找不到对应的使用者资料" };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  const { data: analyst } = await supabase.from("analysts").select("id").eq("party_id", userRow.party_id).maybeSingle();

  return { analystId: analyst?.id ?? null, isBackOffice: !!isBackOffice };
}

const scheduleSchema = z.object({
  child_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  center_id: z.string().uuid(t("schedule.form.error.center_required")),
  device_id: z.string().uuid(t("schedule.form.error.device_required")),
  detection_date: z.string().min(1, t("schedule.form.error.date_required")),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, t("schedule.form.error.start_time_required")),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, t("schedule.form.error.end_time_required")),
});

// Malaysia has a single fixed UTC+8 offset (no DST) — appending it directly
// to the date+time the analyst typed guarantees the correct instant
// regardless of which timezone the server process itself runs in.
function toMYTimestamp(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00+08:00`);
}

export type ScheduleAppointmentState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

// Stage 1 ONLY — reserves a device time slot before any assessment happens.
// Zero report-data fields exist on this form on purpose (see the 2026-07-14
// decoupling fix in migration 022's header comment): this just locks the
// physical resource so two analysts can't book the same machine for
// overlapping times. The resulting row sits at 'pending_assessment' until
// Stage 2 (report/actions.ts's saveOnePageReport) completes it.
export async function scheduleAppointment(_prev: ScheduleAppointmentState, formData: FormData): Promise<ScheduleAppointmentState> {
  const auth = await requireCallerContext();
  if ("error" in auth) return { status: "error", message: auth.error };

  const childIdRaw = formData.get("child_id");
  const childId = typeof childIdRaw === "string" && childIdRaw ? childIdRaw : null;
  const customerIdRaw = formData.get("customer_id");
  const customerIdInput = typeof customerIdRaw === "string" && customerIdRaw ? customerIdRaw : null;
  if (!childId && !customerIdInput) return { status: "error", message: "找不到受测者的资料" };

  // Migration 028 — the subject is either a customer_children row or the
  // customer themselves (adult self-assessment); exactly one of
  // childId/customerIdInput is set by the form.
  const subject = childId ? await getChildContext(childId) : await getCustomerSelfContext(customerIdInput as string);
  if (!subject) return { status: "error", message: "找不到受测者的资料" };

  if (!auth.isBackOffice && auth.analystId !== subject.owner_analyst_id) {
    return { status: "error", message: "没有权限执行此操作" };
  }

  const parsed = scheduleSchema.safeParse({
    child_id: childId ?? undefined,
    customer_id: childId ? undefined : (customerIdInput ?? undefined),
    center_id: formData.get("center_id"),
    device_id: formData.get("device_id"),
    detection_date: formData.get("detection_date"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "表单资料有误" };
  }

  const { center_id, device_id, detection_date, start_time, end_time } = parsed.data;

  const scheduledAt = toMYTimestamp(detection_date, start_time);
  const scheduledEnd = toMYTimestamp(detection_date, end_time);
  const durationMinutes = Math.round((scheduledEnd.getTime() - scheduledAt.getTime()) / 60000);
  if (durationMinutes <= 0) {
    return { status: "error", message: t("schedule.form.error.invalid_time_range") };
  }

  const admin = createAdminClient();
  const performingAnalystId = auth.analystId ?? subject.owner_analyst_id;

  // Device double-booking lock: detection_appointments has a GiST exclusion
  // constraint on (device_id, time_range) — Postgres itself rejects any
  // overlapping active booking for the same device (SQLSTATE 23P01).
  const { error: appointmentError } = await admin.from("detection_appointments").insert({
    customer_id: subject.customer_id,
    child_id: childId,
    analyst_id: performingAnalystId,
    device_id,
    center_id,
    scheduled_at: scheduledAt.toISOString(),
    duration_minutes: durationMinutes,
    status: "pending_assessment",
  });
  if (appointmentError) {
    if (appointmentError.code === "23P01") {
      return { status: "error", message: t("schedule.form.error.device_conflict") };
    }
    return { status: "error", message: `${t("schedule.form.error.save_failed")}${appointmentError.message}` };
  }

  if (childId) {
    revalidatePath(`/admin/customers/children/${childId}/report`);
    revalidatePath(`/admin/customers/children/${childId}/schedule`);
  } else {
    revalidatePath(`/admin/customers/${subject.customer_id}/self-report`);
    revalidatePath(`/admin/customers/${subject.customer_id}/self-schedule`);
  }
  revalidatePath("/admin/schedule");
  return { status: "success" };
}
