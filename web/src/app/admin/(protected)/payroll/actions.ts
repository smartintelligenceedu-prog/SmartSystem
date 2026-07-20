"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

async function requireFinanceUserId(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: await t("reports.error.not_signed_in") };

  const { data: userRow } = await supabase.from("users").select("id, party_id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: await t("reports.error.no_user_row") };

  const { data: roleRows } = await supabase.from("user_roles").select("roles(name)").eq("user_id", userRow.id);
  const roleNames = (roleRows ?? []).map((r) => (r.roles as unknown as { name: string } | null)?.name);
  if (!roleNames.includes("admin") && !roleNames.includes("finance")) {
    return { error: await t("payroll.error.no_permission") };
  }

  return { userId: userRow.id };
}

// Built per-call, not a module-scope constant — see the identical note in
// customers/actions.ts's buildCustomerFormSchema.
async function buildRunPayoutSchema() {
  const invalidPeriodMessage = await t("payroll.error.invalid_period");
  return z.object({
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, invalidPeriodMessage),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, invalidPeriodMessage),
  });
}

export type RunPayoutState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message: string };

// One-click monthly settlement: pulls every already-'approved' commission
// record in the period, tags it 'paid' + this run's id (locking it against
// being pulled into a future run), then rolls the tagged records up into
// one analyst_payslips row per analyst and one introducer_commission_
// statements row per introducer. Approval itself is a separate, existing
// manual step (see the comment in commission_engine.sql) — this action only
// ever touches records someone already reviewed.
export async function runMonthlyPayout(_prev: RunPayoutState, formData: FormData): Promise<RunPayoutState> {
  const auth = await requireFinanceUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const runPayoutSchema = await buildRunPayoutSchema();
  const parsed = runPayoutSchema.safeParse({
    period_start: formData.get("period_start"),
    period_end: formData.get("period_end"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? await t("payroll.error.invalid_period") };
  }
  const { period_start, period_end } = parsed.data;
  if (period_end < period_start) {
    return { status: "error", message: await t("payroll.error.invalid_period_range") };
  }

  const admin = createAdminClient();

  const { data: existingRun } = await admin
    .from("commission_payout_runs")
    .select("id")
    .eq("period_start", period_start)
    .eq("period_end", period_end)
    .maybeSingle();
  if (existingRun) return { status: "error", message: await t("payroll.error.period_already_run") };

  const { data: run, error: runError } = await admin
    .from("commission_payout_runs")
    .insert({ period_start, period_end, processed_by: auth.userId })
    .select("id")
    .single();
  if (runError) return { status: "error", message: `${await t("payroll.error.run_failed")}${runError.message}` };

  // period_end is a date; calculated_at is a timestamptz — add one day so
  // the whole end date is included regardless of time-of-day.
  const periodEndExclusive = new Date(`${period_end}T00:00:00+08:00`);
  periodEndExclusive.setDate(periodEndExclusive.getDate() + 1);
  const periodStartInclusive = new Date(`${period_start}T00:00:00+08:00`).toISOString();

  const { data: approvedRecords } = await admin
    .from("commission_records")
    .select("id, analyst_id, introducer_id, commission_amount")
    .eq("status", "approved")
    .gte("calculated_at", periodStartInclusive)
    .lt("calculated_at", periodEndExclusive.toISOString());

  if (!approvedRecords || approvedRecords.length === 0) {
    return { status: "success", message: await t("payroll.run.no_approved_records") };
  }

  const recordIds = approvedRecords.map((r) => r.id);
  const { error: tagError } = await admin
    .from("commission_records")
    .update({ status: "paid", paid_at: new Date().toISOString(), payout_run_id: run.id })
    .in("id", recordIds);
  if (tagError) return { status: "error", message: `${await t("payroll.error.run_failed")}${tagError.message}` };

  const analystTotals = new Map<string, number>();
  const introducerTotals = new Map<string, number>();
  for (const r of approvedRecords) {
    if (r.analyst_id) analystTotals.set(r.analyst_id, (analystTotals.get(r.analyst_id) ?? 0) + Number(r.commission_amount));
    if (r.introducer_id) introducerTotals.set(r.introducer_id, (introducerTotals.get(r.introducer_id) ?? 0) + Number(r.commission_amount));
  }

  if (analystTotals.size > 0) {
    const payslipRows = [...analystTotals.entries()].map(([analyst_id, gross_amount]) => ({
      payout_run_id: run.id,
      analyst_id,
      gross_amount,
    }));
    const { error } = await admin.from("analyst_payslips").insert(payslipRows);
    if (error) return { status: "error", message: `${await t("payroll.error.run_failed")}${error.message}` };
  }

  if (introducerTotals.size > 0) {
    const statementRows = [...introducerTotals.entries()].map(([introducer_id, gross_amount]) => ({
      payout_run_id: run.id,
      introducer_id,
      gross_amount,
    }));
    const { error } = await admin.from("introducer_commission_statements").insert(statementRows);
    if (error) return { status: "error", message: `${await t("payroll.error.run_failed")}${error.message}` };
  }

  revalidatePath("/admin/payroll");
  return {
    status: "success",
    message: `${await t("payroll.run.success_prefix")}${analystTotals.size}${await t("payroll.run.success_analysts")}${introducerTotals.size}${await t("payroll.run.success_introducers")}`,
  };
}

const createStaffPayslipSchema = z.object({
  party_id: z.string().uuid(await t("payroll.staff.error.select_recipient")),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, await t("payroll.error.invalid_period")),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, await t("payroll.error.invalid_period")),
  gross_amount: z.coerce.number().positive(await t("payroll.staff.error.invalid_amount")),
  description: z.string().trim().optional(),
});

export type CreateStaffPayslipState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

// Deliberately manual (the user's explicit choice over a stored monthly
// salary + auto-run): back office types an amount each time a plain staff
// member (neither analyst nor introducer) gets paid, same posture as
// adminAdjustCommission's manual override.
export async function createStaffPayslip(_prev: CreateStaffPayslipState, formData: FormData): Promise<CreateStaffPayslipState> {
  const auth = await requireFinanceUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const parsed = createStaffPayslipSchema.safeParse({
    party_id: formData.get("party_id"),
    period_start: formData.get("period_start"),
    period_end: formData.get("period_end"),
    gross_amount: formData.get("gross_amount"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? await t("payroll.error.invalid_period") };
  }
  const input = parsed.data;
  if (input.period_end < input.period_start) {
    return { status: "error", message: await t("payroll.error.invalid_period_range") };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("staff_payslips").insert({
    party_id: input.party_id,
    period_start: input.period_start,
    period_end: input.period_end,
    gross_amount: input.gross_amount,
    description: input.description ?? null,
    created_by: auth.userId,
  });
  if (error) return { status: "error", message: `${await t("payroll.error.run_failed")}${error.message}` };

  revalidatePath("/admin/payroll");
  return { status: "success" };
}
