"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChildContext, getCustomerSelfContext } from "../report/data";
import { createCustomer } from "../../../actions";
import { t } from "@/lib/i18n";

async function requireCallerContext(): Promise<{ analystId: string | null; isBackOffice: boolean } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: await t("schedule.form.error.not_signed_in") };

  const { data: userRow } = await supabase.from("users").select("id, party_id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: await t("schedule.form.error.no_user_row") };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  const { data: analyst } = await supabase.from("analysts").select("id").eq("party_id", userRow.party_id).maybeSingle();

  return { analystId: analyst?.id ?? null, isBackOffice: !!isBackOffice };
}

// Built per-call, not a module-scope constant — see the identical note in
// customers/actions.ts's buildCustomerFormSchema.
async function buildScheduleSchema() {
  return z.object({
    child_id: z.string().uuid().optional(),
    customer_id: z.string().uuid().optional(),
    center_id: z.string().uuid(await t("schedule.form.error.center_required")),
    device_id: z.string().uuid(await t("schedule.form.error.device_required")),
    detection_date: z.string().min(1, await t("schedule.form.error.date_required")),
    start_time: z.string().regex(/^\d{2}:\d{2}$/, await t("schedule.form.error.start_time_required")),
    end_time: z.string().regex(/^\d{2}:\d{2}$/, await t("schedule.form.error.end_time_required")),
  });
}

// Malaysia has a single fixed UTC+8 offset (no DST) — appending it directly
// to the date+time the analyst typed guarantees the correct instant
// regardless of which timezone the server process itself runs in.
function toMYTimestamp(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00+08:00`);
}

export type ScheduleAppointmentState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

// Shared by scheduleAppointment() and scheduleAppointmentForNewCustomer()
// below — the actual device-slot reservation, once a customer_id (and
// optional child_id) already exist. Device double-booking lock:
// detection_appointments has a GiST exclusion constraint on
// (device_id, time_range) — Postgres itself rejects any overlapping active
// booking for the same device (SQLSTATE 23P01).
async function insertAppointment(params: {
  // null only for the booth-reserved case (migration 042) — the DB's own
  // check constraint (customer_id is not null or status = 'booth_reserved')
  // is the real guard; this function just has to pass the right status
  // alongside a null customer_id, never null customer_id on its own.
  customerId: string | null;
  childId: string | null;
  analystId: string;
  centerId: string;
  deviceId: string;
  detectionDate: string;
  startTime: string;
  endTime: string;
  status?: "pending_assessment" | "booth_reserved";
}): Promise<ScheduleAppointmentState> {
  const scheduledAt = toMYTimestamp(params.detectionDate, params.startTime);
  const scheduledEnd = toMYTimestamp(params.detectionDate, params.endTime);
  const durationMinutes = Math.round((scheduledEnd.getTime() - scheduledAt.getTime()) / 60000);
  if (durationMinutes <= 0) {
    return { status: "error", message: await t("schedule.form.error.invalid_time_range") };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("detection_appointments").insert({
    customer_id: params.customerId,
    child_id: params.childId,
    analyst_id: params.analystId,
    device_id: params.deviceId,
    center_id: params.centerId,
    scheduled_at: scheduledAt.toISOString(),
    duration_minutes: durationMinutes,
    status: params.status ?? "pending_assessment",
  });
  if (error) {
    if (error.code === "23P01") {
      return { status: "error", message: await t("schedule.form.error.device_conflict") };
    }
    return { status: "error", message: `${await t("schedule.form.error.save_failed")}${error.message}` };
  }
  return { status: "success" };
}

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
  if (!childId && !customerIdInput) return { status: "error", message: await t("schedule.form.error.subject_not_found") };

  // Migration 028 — the subject is either a customer_children row or the
  // customer themselves (adult self-assessment); exactly one of
  // childId/customerIdInput is set by the form.
  const subject = childId ? await getChildContext(childId) : await getCustomerSelfContext(customerIdInput as string);
  if (!subject) return { status: "error", message: await t("schedule.form.error.subject_not_found") };

  if (!auth.isBackOffice && auth.analystId !== subject.owner_analyst_id) {
    return { status: "error", message: await t("schedule.form.error.no_permission") };
  }

  const scheduleSchema = await buildScheduleSchema();
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
    return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("schedule.form.error.invalid_form")) };
  }

  const { center_id, device_id, detection_date, start_time, end_time } = parsed.data;
  const performingAnalystId = auth.analystId ?? subject.owner_analyst_id;

  const result = await insertAppointment({
    customerId: subject.customer_id,
    childId,
    analystId: performingAnalystId,
    centerId: center_id,
    deviceId: device_id,
    detectionDate: detection_date,
    startTime: start_time,
    endTime: end_time,
  });
  if (result.status !== "success") return result;

  if (childId) {
    revalidatePath(`/admin/customers/children/${childId}/report`);
    revalidatePath(`/admin/customers/children/${childId}/schedule`);
  } else {
    revalidatePath(`/admin/customers/${subject.customer_id}/self-report`);
    revalidatePath(`/admin/customers/${subject.customer_id}/self-schedule`);
  }
  revalidatePath("/admin/schedule");
  return result;
}

// Built inside the action (not at module scope) — see the note in
// buildScheduleSchema() above / customers/actions.ts's buildCustomerFormSchema.
async function buildNewCustomerScheduleSchema() {
  return z.object({
    new_customer_name: z.string().trim().min(2, await t("customer.error.required_name")),
    new_customer_phone: z.string().trim().min(8, await t("customer.error.required_phone")),
    new_child_name: z.string().trim().optional(),
    center_id: z.string().uuid(await t("schedule.form.error.center_required")),
    device_id: z.string().uuid(await t("schedule.form.error.device_required")),
    detection_date: z.string().min(1, await t("schedule.form.error.date_required")),
    start_time: z.string().regex(/^\d{2}:\d{2}$/, await t("schedule.form.error.start_time_required")),
    end_time: z.string().regex(/^\d{2}:\d{2}$/, await t("schedule.form.error.end_time_required")),
  });
}

// Booth/roadshow/school-visit booking: the walk-in isn't in the system yet,
// so this creates a real customer (reusing createCustomer() — same
// duplicate-phone check and activity log a normal registration gets, not a
// second-class shortcut) and optional child, then reserves the device slot
// the same way scheduleAppointment() does. Only a real analyst can own the
// new customer (customers.owner_analyst_id is not null), so unlike
// scheduleAppointment() this has no back-office-without-analystId path.
export async function scheduleAppointmentForNewCustomer(
  _prev: ScheduleAppointmentState,
  formData: FormData
): Promise<ScheduleAppointmentState> {
  const auth = await requireCallerContext();
  if ("error" in auth) return { status: "error", message: auth.error };
  if (!auth.analystId) return { status: "error", message: await t("schedule.form.error.no_permission") };

  const schema = await buildNewCustomerScheduleSchema();
  const parsed = schema.safeParse({
    new_customer_name: formData.get("new_customer_name"),
    new_customer_phone: formData.get("new_customer_phone"),
    new_child_name: formData.get("new_child_name") || undefined,
    center_id: formData.get("center_id"),
    device_id: formData.get("device_id"),
    detection_date: formData.get("detection_date"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("schedule.form.error.invalid_form")) };
  }
  const input = parsed.data;

  const customerFormData = new FormData();
  customerFormData.set("full_name", input.new_customer_name);
  customerFormData.set("phone", input.new_customer_phone);
  const customerResult = await createCustomer({ status: "idle" }, customerFormData);
  if (customerResult.status !== "success") {
    return {
      status: "error",
      message: customerResult.status === "error" ? customerResult.message : await t("schedule.form.error.save_failed"),
    };
  }
  const customerId = customerResult.customerId;

  const admin = createAdminClient();
  let childId: string | null = null;
  if (input.new_child_name) {
    const { data: child, error: childError } = await admin
      .from("customer_children")
      .insert({ customer_id: customerId, full_name: input.new_child_name })
      .select("id")
      .single();
    if (childError) return { status: "error", message: `${await t("schedule.form.error.save_failed")}${childError.message}` };
    childId = child.id;
  }

  const result = await insertAppointment({
    customerId,
    childId,
    analystId: auth.analystId,
    centerId: input.center_id,
    deviceId: input.device_id,
    detectionDate: input.detection_date,
    startTime: input.start_time,
    endTime: input.end_time,
  });
  if (result.status !== "success") return result;

  revalidatePath("/admin/customers");
  revalidatePath("/admin/schedule");
  if (childId) {
    revalidatePath(`/admin/customers/children/${childId}/report`);
  } else {
    revalidatePath(`/admin/customers/${customerId}/self-report`);
  }
  return result;
}

// Built inside the action (not at module scope) — see the note in
// buildScheduleSchema() above / customers/actions.ts's buildCustomerFormSchema.
async function buildBoothReservationSchema() {
  return z.object({
    center_id: z.string().uuid(await t("schedule.form.error.center_required")),
    device_id: z.string().uuid(await t("schedule.form.error.device_required")),
    detection_date: z.string().min(1, await t("schedule.form.error.date_required")),
    start_time: z.string().regex(/^\d{2}:\d{2}$/, await t("schedule.form.error.start_time_required")),
    end_time: z.string().regex(/^\d{2}:\d{2}$/, await t("schedule.form.error.end_time_required")),
  });
}

// Pure placeholder — blocks a device/time on the shared timeline for a
// booth/roadshow/school visit with no customer attached yet (migration 042).
// Never becomes a real report: walk-ins during that event still get their
// own real booking via scheduleAppointment()/scheduleAppointmentForNewCustomer()
// once they're actually in front of the device. This only exists so other
// analysts see the device is unavailable instead of trying to book over it.
export async function reserveDeviceForBooth(_prev: ScheduleAppointmentState, formData: FormData): Promise<ScheduleAppointmentState> {
  const auth = await requireCallerContext();
  if ("error" in auth) return { status: "error", message: auth.error };
  if (!auth.analystId) return { status: "error", message: await t("schedule.form.error.no_permission") };

  const schema = await buildBoothReservationSchema();
  const parsed = schema.safeParse({
    center_id: formData.get("center_id"),
    device_id: formData.get("device_id"),
    detection_date: formData.get("detection_date"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("schedule.form.error.invalid_form")) };
  }
  const input = parsed.data;

  const result = await insertAppointment({
    customerId: null,
    childId: null,
    analystId: auth.analystId,
    centerId: input.center_id,
    deviceId: input.device_id,
    detectionDate: input.detection_date,
    startTime: input.start_time,
    endTime: input.end_time,
    status: "booth_reserved",
  });
  if (result.status !== "success") return result;

  revalidatePath("/admin/schedule");
  return result;
}
