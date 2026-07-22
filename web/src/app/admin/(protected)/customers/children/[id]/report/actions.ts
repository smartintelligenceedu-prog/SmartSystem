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
  if (!user) return { error: await t("tqc.form.error.not_signed_in") };

  const { data: userRow } = await supabase.from("users").select("id, party_id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: await t("tqc.form.error.no_user_row") };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  const { data: analyst } = await supabase.from("analysts").select("id").eq("party_id", userRow.party_id).maybeSingle();

  return { analystId: analyst?.id ?? null, isBackOffice: !!isBackOffice };
}

const learningStyleValues = LEARNING_STYLES.map((s) => s.value) as [string, ...string[]];

// Built per-call (not a module-scope constant) — every message here uses
// t(), which is locale-aware; a module-scope schema would freeze those
// lookups at whatever locale happened to be active the first time this
// module loaded, and never update again for other requests/users.
async function buildSaveReportSchema() {
  const scoreRangeMessage = await t("tqc.form.error.score_range");
  const scoreSchema = z.coerce.number().min(0, scoreRangeMessage).max(100, scoreRangeMessage);
  const zoneCategorySchema = z.enum(ZONE_CATEGORIES, { message: await t("tqc.form.error.zone_category_required") });
  return z.object({
    child_id: z.string().uuid().optional(),
    customer_id: z.string().uuid().optional(),
    appointment_id: z.string().uuid(await t("tqc.form.error.appointment_required")),
    left_brain_pct: scoreSchema,
    right_brain_pct: scoreSchema,
    personality_type: z.enum(PERSONALITY_TYPE_VALUES, { message: await t("tqc.form.error.personality_required") }),
    tqc_activity_score: z.coerce.number().min(0, await t("tqc.form.error.activity_score_negative")),
    learning_styles: z.array(z.enum(learningStyleValues)),
    analyst_summary: z.string().trim().optional(),
    ...Object.fromEntries(BRAIN_ZONES.map((zone) => [zone.field, scoreSchema])),
    // Loop variable deliberately not named `z` here — this codebase's `z` import
    // is the zod namespace, and `zoneCategorySchema` (built from it) is
    // referenced inside this same map callback.
    ...Object.fromEntries(BRAIN_ZONES.map((zone) => [`zone_category_${zone.field}`, zoneCategorySchema])),
  });
}

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
  if (!childId && !customerId) return { status: "error", message: await t("tqc.form.error.subject_not_found") };

  // Migration 028 — the subject is either a customer_children row or the
  // customer themselves (adult self-assessment); exactly one of
  // childId/customerId is set by the form.
  const subject = childId ? await getChildContext(childId) : await getCustomerSelfContext(customerId as string);
  if (!subject) return { status: "error", message: await t("tqc.form.error.subject_not_found") };

  if (!auth.isBackOffice && auth.analystId !== subject.owner_analyst_id) {
    return { status: "error", message: await t("tqc.form.error.no_permission") };
  }

  const learningStyles = formData.getAll("learning_styles");

  const saveReportSchema = await buildSaveReportSchema();
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
    return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("tqc.form.error.invalid_form")) };
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
  if (!appointment) return { status: "error", message: await t("tqc.form.error.appointment_not_found") };
  if (appointment.status !== "pending_assessment") {
    return { status: "error", message: await t("tqc.form.error.appointment_already_completed") };
  }

  // Optional: spend one of the analyst's own self-use vouchers on this
  // report, so it shows up in Sales Orders (RM0, no commission) instead of
  // being invisible billing-wise. Checked up front, before any writes below,
  // so a stale checkbox (voucher already spent elsewhere since page load)
  // fails the whole save cleanly rather than leaving a half-completed report.
  const useSelfUseVoucher = formData.get("use_self_use_voucher") === "true";
  let selfUseVoucherId: string | null = null;
  if (useSelfUseVoucher) {
    const { data: voucher } = await admin
      .from("detection_vouchers")
      .select("id")
      .eq("analyst_id", appointment.analyst_id)
      .eq("voucher_type", "self_use")
      .eq("status", "issued")
      .order("issued_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!voucher) return { status: "error", message: await t("tqc.form.error.no_self_use_voucher_available") };
    selfUseVoucherId = voucher.id;
  }

  const { error: appointmentError } = await admin
    .from("detection_appointments")
    .update({ status: "completed" })
    .eq("id", appointment_id);
  if (appointmentError) return { status: "error", message: `${await t("tqc.form.error.appointment_save_failed")}${appointmentError.message}` };

  const { data: session, error: sessionError } = await admin
    .from("detection_sessions")
    .insert({
      appointment_id,
      customer_id: appointment.customer_id,
      child_id,
      analyst_id: appointment.analyst_id,
      device_id: appointment.device_id,
      status: "completed",
    })
    .select("id")
    .single();
  if (sessionError) return { status: "error", message: `${await t("tqc.form.error.session_save_failed")}${sessionError.message}` };

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
  if (error) return { status: "error", message: `${await t("tqc.form.error.report_save_failed")}${error.message}` };

  if (selfUseVoucherId) {
    // item_type 'other' (not 'detection_session') deliberately skips
    // commission_engine.sql's detection_service loop — a self-use redemption
    // is free (already paid for at registration), so no commission should
    // fire. Goes straight to 'paid' like voucher_redemption does, since
    // there's no payment to review.
    const { data: order } = await admin
      .from("orders")
      .insert({ order_type: "detection_service", analyst_id: appointment.analyst_id, total_amount: 0, status: "pending" })
      .select("id")
      .single();
    if (order) {
      const { data: orderItem } = await admin
        .from("order_items")
        .insert({
          order_id: order.id,
          item_type: "other",
          description: await t("sales_orders.item.self_use_voucher_description"),
          unit_price: 0,
          quantity: 1,
          subtotal: 0,
          customer_id: appointment.customer_id,
          analyst_id: appointment.analyst_id,
        })
        .select("id")
        .single();
      await admin.from("orders").update({ status: "paid" }).eq("id", order.id);
      if (orderItem) {
        await admin.from("detection_sessions").update({ order_item_id: orderItem.id }).eq("id", session.id);
      }
    }
    await admin
      .from("detection_vouchers")
      .update({ status: "redeemed", redeemed_at: new Date().toISOString(), redeemed_session_id: session.id })
      .eq("id", selfUseVoucherId);
    revalidatePath("/admin/sales-orders");
    revalidatePath("/admin");
  }

  if (child_id) {
    revalidatePath(`/admin/customers/children/${child_id}/report`);
  } else {
    revalidatePath(`/admin/customers/${subject.customer_id}/self-report`);
  }
  revalidatePath(`/admin/customers/${subject.customer_id}`);
  revalidatePath("/admin/schedule");
  return { status: "success" };
}
