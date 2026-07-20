"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChildContext, getCustomerSelfContext } from "./data";
import { BRAIN_ZONES, LEARNING_STYLES, PERSONALITY_TYPE_VALUES, ZONE_CATEGORIES } from "./brain-zones";
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

const scoreSchema = z.coerce.number().min(0, "分数必须介于 0-100 之间").max(100, "分数必须介于 0-100 之间");
const zoneCategorySchema = z.enum(ZONE_CATEGORIES, { message: "请为每个脑区选择分类" });
const learningStyleValues = LEARNING_STYLES.map((s) => s.value) as [string, ...string[]];

const saveReportSchema = z.object({
  child_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  appointment_id: z.string().uuid(t("tqc.form.error.appointment_required")),
  left_brain_pct: scoreSchema,
  right_brain_pct: scoreSchema,
  personality_type: z.enum(PERSONALITY_TYPE_VALUES, { message: "请选择性格类型" }),
  tqc_activity_score: z.coerce.number().min(0, "脑活跃度分数不能为负数"),
  learning_styles: z.array(z.enum(learningStyleValues)),
  analyst_summary: z.string().trim().optional(),
  ...Object.fromEntries(BRAIN_ZONES.map((zone) => [zone.field, scoreSchema])),
  // Loop variable deliberately not named `z` here — this codebase's `z` import
  // is the zod namespace, and `zoneCategorySchema` (built from it) is
  // referenced inside this same map callback.
  ...Object.fromEntries(BRAIN_ZONES.map((zone) => [`zone_category_${zone.field}`, zoneCategorySchema])),
});

export type SaveOnePageReportState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

// Stage 2 ONLY — score entry for an appointment that already exists and is
// still 'pending_assessment' (created by Stage 1's scheduleAppointment()).
// This form never creates or edits a device/time booking; that's the whole
// point of the 2026-07-14 decoupling fix (see database/migrations/022_...):
// front-line staff were typing junk scores just to reserve a machine before
// the assessment had even happened, corrupting the CRM auto-tagging system.
//
// Gate: back office OR the child's customer's OWNING analyst — same as
// every other mutation in this codebase. The write still goes through the
// admin client; RLS stays back-office-only as the conservative default.
export async function saveOnePageReport(_prev: SaveOnePageReportState, formData: FormData): Promise<SaveOnePageReportState> {
  const auth = await requireCallerContext();
  if ("error" in auth) return { status: "error", message: auth.error };

  const childIdRaw = formData.get("child_id");
  const childId = typeof childIdRaw === "string" && childIdRaw ? childIdRaw : null;
  const customerIdRaw = formData.get("customer_id");
  const customerId = typeof customerIdRaw === "string" && customerIdRaw ? customerIdRaw : null;
  if (!childId && !customerId) return { status: "error", message: "找不到受测者的资料" };

  // Migration 028 — the subject is either a customer_children row or the
  // customer themselves (adult self-assessment); exactly one of
  // childId/customerId is set by the form.
  const subject = childId ? await getChildContext(childId) : await getCustomerSelfContext(customerId as string);
  if (!subject) return { status: "error", message: "找不到受测者的资料" };

  if (!auth.isBackOffice && auth.analystId !== subject.owner_analyst_id) {
    return { status: "error", message: "没有权限执行此操作" };
  }

  const learningStyles = formData.getAll("learning_styles");

  const parsed = saveReportSchema.safeParse({
    child_id: childId ?? undefined,
    customer_id: childId ? undefined : (customerId ?? undefined),
    appointment_id: formData.get("appointment_id"),
    left_brain_pct: formData.get("left_brain_pct"),
    right_brain_pct: formData.get("right_brain_pct"),
    personality_type: formData.get("personality_type"),
    tqc_activity_score: formData.get("tqc_activity_score"),
    learning_styles: learningStyles,
    analyst_summary: formData.get("analyst_summary") || undefined,
    ...Object.fromEntries(BRAIN_ZONES.map((zone) => [zone.field, formData.get(zone.field)])),
    ...Object.fromEntries(BRAIN_ZONES.map((zone) => [`zone_category_${zone.field}`, formData.get(`zone_category_${zone.field}`)])),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "表单资料有误" };
  }

  // zone_category_<field> fields aren't real table columns — collapse them
  // into the single zone_categories JSONB map the DB actually stores
  // (migration 036) before spreading `rest` into the insert below.
  const zoneCategories: Record<string, string> = {};
  for (const zone of BRAIN_ZONES) {
    zoneCategories[zone.field] = parsed.data[`zone_category_${zone.field}` as keyof typeof parsed.data] as unknown as string;
  }
  const { child_id, customer_id, appointment_id, ...restWithZoneCategoryKeys } = parsed.data;
  const rest = Object.fromEntries(
    Object.entries(restWithZoneCategoryKeys).filter(([key]) => !key.startsWith("zone_category_"))
  ) as Omit<typeof restWithZoneCategoryKeys, `zone_category_${string}`>;
  const admin = createAdminClient();

  // The appointment must exist, belong to this subject, and still be
  // waiting for its result — this is the only thing standing in for "the
  // machine was actually booked and used", so it can't be skipped or faked
  // from this form (there are no device/date/time fields here to fake it with).
  let appointmentQuery = admin
    .from("detection_appointments")
    .select("id, analyst_id, device_id, customer_id, status")
    .eq("id", appointment_id);
  appointmentQuery = child_id
    ? appointmentQuery.eq("child_id", child_id)
    : appointmentQuery.eq("customer_id", subject.customer_id).is("child_id", null);
  const { data: appointment } = await appointmentQuery.maybeSingle();
  if (!appointment) return { status: "error", message: t("tqc.form.error.appointment_not_found") };
  if (appointment.status !== "pending_assessment") {
    return { status: "error", message: t("tqc.form.error.appointment_already_completed") };
  }

  const { error: appointmentError } = await admin
    .from("detection_appointments")
    .update({ status: "completed" })
    .eq("id", appointment_id);
  if (appointmentError) return { status: "error", message: `${t("tqc.form.error.appointment_save_failed")}${appointmentError.message}` };

  const { error: sessionError } = await admin.from("detection_sessions").insert({
    appointment_id,
    customer_id: appointment.customer_id,
    child_id,
    analyst_id: appointment.analyst_id,
    device_id: appointment.device_id,
    status: "completed",
  });
  if (sessionError) return { status: "error", message: `登记检测纪录失败：${sessionError.message}` };

  // A new historical row every save (a subject can be retested); the
  // tag-derivation trigger only acts on whichever row is currently the
  // most recent for this subject.
  const { error } = await admin.from("tqc_one_page_reports").insert({
    child_id,
    customer_id: child_id ? null : customer_id,
    created_by_analyst_id: auth.analystId,
    ...rest,
    analyst_summary: rest.analyst_summary || null,
    zone_categories: zoneCategories,
  });
  if (error) return { status: "error", message: `保存报告失败：${error.message}` };

  if (child_id) {
    revalidatePath(`/admin/customers/children/${child_id}/report`);
  } else {
    revalidatePath(`/admin/customers/${subject.customer_id}/self-report`);
  }
  revalidatePath(`/admin/customers/${subject.customer_id}`);
  revalidatePath("/admin/schedule");
  return { status: "success" };
}
