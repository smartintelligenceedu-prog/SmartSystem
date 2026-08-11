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

  // Only create the run row once there's something to actually settle —
  // creating it upfront (as this used to) permanently locks the period out
  // via the existingRun check above even when zero records were processed,
  // with no way to retry later once commissions for that period actually
  // get approved (this is exactly what happened to a real July period:
  // an early/premature run found nothing, but the period could never be
  // re-run once the real commissions were approved afterward).
  if (!approvedRecords || approvedRecords.length === 0) {
    return { status: "success", message: await t("payroll.run.no_approved_records") };
  }

  const { data: run, error: runError } = await admin
    .from("commission_payout_runs")
    .insert({ period_start, period_end, processed_by: auth.userId })
    .select("id")
    .single();
  if (runError) return { status: "error", message: `${await t("payroll.error.run_failed")}${runError.message}` };

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

  // postToLedger() only ever posts the ACCRUAL (Dr expense / Cr 2000
  // Commission Payable) the moment a commission_record exists — nothing
  // previously debited 2000 back down once it was actually paid out, so the
  // liability just accumulated forever with no ledger trace of real cash
  // leaving the company. This posts that missing settlement entry for the
  // run's total (Dr 2000 / Cr 1000), dated the day the run actually
  // executed (not the period it covers — that's when the accrual posted).
  const totalPayout = approvedRecords.reduce((sum, r) => sum + Number(r.commission_amount), 0);
  const { data: settlementAccounts } = await admin.from("chart_of_accounts").select("id, code").in("code", ["1000", "2000"]);
  const settlementAccountIdByCode = new Map((settlementAccounts ?? []).map((a) => [a.code, a.id]));
  const cashAccountId = settlementAccountIdByCode.get("1000");
  const payableAccountId = settlementAccountIdByCode.get("2000");
  if (!cashAccountId || !payableAccountId) {
    return { status: "error", message: await t("finance.error.missing_accounts") };
  }
  const { data: settlementEntry, error: settlementEntryError } = await admin
    .from("journal_entries")
    .insert({
      entry_date: new Date().toISOString().slice(0, 10),
      source_type: "commission_payout_run",
      source_id: run.id,
      description: `${await t("payroll.run.settlement_description_prefix")}${period_start} ~ ${period_end}`,
      posted_by: auth.userId,
    })
    .select("id")
    .single();
  if (settlementEntryError || !settlementEntry) {
    return { status: "error", message: `${await t("payroll.error.run_failed")}${settlementEntryError?.message ?? ""}` };
  }
  const { error: settlementLinesError } = await admin.from("journal_lines").insert([
    { journal_entry_id: settlementEntry.id, account_id: payableAccountId, debit: totalPayout, credit: 0 },
    { journal_entry_id: settlementEntry.id, account_id: cashAccountId, debit: 0, credit: totalPayout },
  ]);
  if (settlementLinesError) return { status: "error", message: `${await t("payroll.error.run_failed")}${settlementLinesError.message}` };

  revalidatePath("/admin/payroll");
  revalidatePath("/admin/finance");
  return {
    status: "success",
    message: `${await t("payroll.run.success_prefix")}${analystTotals.size}${await t("payroll.run.success_analysts")}${introducerTotals.size}${await t("payroll.run.success_introducers")}`,
  };
}

// Built inside the action (not at module scope) — t() awaits cookies() from
// next/headers, which only works inside an active request; a top-level
// `await t(...)` runs during module evaluation instead and throws every time
// this module is loaded to dispatch a Server Action here.
async function buildCreateStaffPayslipSchema() {
  return z.object({
    party_id: z.string().uuid(await t("payroll.staff.error.select_recipient")),
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, await t("payroll.error.invalid_period")),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, await t("payroll.error.invalid_period")),
    gross_amount: z.coerce.number().positive(await t("payroll.staff.error.invalid_amount")),
    description: z.string().trim().optional(),
    document_type: z.enum(["payslip", "admin_fee"]).default("payslip"),
  });
}

export type CreateStaffPayslipState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

async function getIndividualName(admin: ReturnType<typeof createAdminClient>, partyId: string): Promise<string> {
  const { data } = await admin.from("individuals").select("full_name").eq("party_id", partyId).maybeSingle();
  return data?.full_name ?? "—";
}

async function getAccountIds(admin: ReturnType<typeof createAdminClient>, codes: string[]): Promise<Map<string, string>> {
  const { data } = await admin.from("chart_of_accounts").select("id, code").in("code", codes);
  return new Map((data ?? []).map((a) => [a.code, a.id]));
}

// Posts a 'payslip' (Dr 6300 Staff Salary / Cr 1000 Cash) — a payslip
// already represents a completed payment (see the comment on
// createStaffPayslip below), so it posts immediately at creation, same
// posture as recordOperatingExpense() — or, for an 'admin_fee' once it's
// actually collected, the reverse (Dr 1000 Cash / Cr 4900 Admin Fee
// Recovery). entry_date is the pay period's end date for a payslip (the
// period it covers); today's date for an admin_fee (the date it was paid).
// Migration 074.
async function postStaffPayslipEntry(
  admin: ReturnType<typeof createAdminClient>,
  payslip: { id: string; document_type: "payslip" | "admin_fee"; gross_amount: number; description: string | null; party_id: string; period_end: string },
  postedBy: string
): Promise<{ error?: string }> {
  const debitCode = payslip.document_type === "payslip" ? "6300" : "1000";
  const creditCode = payslip.document_type === "payslip" ? "1000" : "4900";
  const accountIds = await getAccountIds(admin, [debitCode, creditCode]);
  const debitAccountId = accountIds.get(debitCode);
  const creditAccountId = accountIds.get(creditCode);
  if (!debitAccountId || !creditAccountId) return { error: await t("finance.error.missing_accounts") };

  const name = await getIndividualName(admin, payslip.party_id);
  const label = payslip.document_type === "payslip" ? await t("payroll.staff.payslip_title") : await t("payroll.admin_fee.print_title");
  const entryDate = payslip.document_type === "payslip" ? payslip.period_end : new Date().toISOString().slice(0, 10);

  const { data: entry, error: entryError } = await admin
    .from("journal_entries")
    .insert({
      entry_date: entryDate,
      source_type: "staff_payslip",
      source_id: payslip.id,
      description: `${label} - ${name}${payslip.description ? ` - ${payslip.description}` : ""}`,
      posted_by: postedBy,
    })
    .select("id")
    .single();
  if (entryError || !entry) return { error: entryError?.message ?? await t("finance.error.unknown_error") };

  const { error: linesError } = await admin.from("journal_lines").insert([
    { journal_entry_id: entry.id, account_id: debitAccountId, debit: payslip.gross_amount, credit: 0 },
    { journal_entry_id: entry.id, account_id: creditAccountId, debit: 0, credit: payslip.gross_amount },
  ]);
  if (linesError) return { error: linesError.message };
  return {};
}

// True once a non-voided journal_entries row exists for this payslip — a
// 'payslip' is always posted immediately at creation (see below), so this
// is only ever meaningfully false for an unpaid 'admin_fee'.
async function isStaffPayslipPosted(admin: ReturnType<typeof createAdminClient>, payslipId: string): Promise<boolean> {
  const { data } = await admin
    .from("journal_entries")
    .select("id")
    .eq("source_type", "staff_payslip")
    .eq("source_id", payslipId)
    .neq("status", "voided")
    .maybeSingle();
  return !!data;
}

// Deliberately manual (the user's explicit choice over a stored monthly
// salary + auto-run): back office types an amount each time a plain staff
// member (neither analyst nor introducer) gets paid, same posture as
// adminAdjustCommission's manual override. A 'payslip' posts to the ledger
// immediately (migration 074) since creating one already means the payment
// happened; an 'admin_fee' only posts once markStaffPayslipPaid runs.
export async function createStaffPayslip(_prev: CreateStaffPayslipState, formData: FormData): Promise<CreateStaffPayslipState> {
  const auth = await requireFinanceUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const createStaffPayslipSchema = await buildCreateStaffPayslipSchema();
  const parsed = createStaffPayslipSchema.safeParse({
    party_id: formData.get("party_id"),
    period_start: formData.get("period_start"),
    period_end: formData.get("period_end"),
    gross_amount: formData.get("gross_amount"),
    description: formData.get("description") || undefined,
    document_type: formData.get("document_type") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? await t("payroll.error.invalid_period") };
  }
  const input = parsed.data;
  if (input.period_end < input.period_start) {
    return { status: "error", message: await t("payroll.error.invalid_period_range") };
  }

  const admin = createAdminClient();
  const { data: payslip, error } = await admin
    .from("staff_payslips")
    .insert({
      party_id: input.party_id,
      period_start: input.period_start,
      period_end: input.period_end,
      gross_amount: input.gross_amount,
      description: input.description ?? null,
      created_by: auth.userId,
      document_type: input.document_type,
    })
    .select("id")
    .single();
  if (error || !payslip) return { status: "error", message: `${await t("payroll.error.run_failed")}${error?.message ?? ""}` };

  if (input.document_type === "payslip") {
    const posting = await postStaffPayslipEntry(
      admin,
      { id: payslip.id, document_type: "payslip", gross_amount: input.gross_amount, description: input.description ?? null, party_id: input.party_id, period_end: input.period_end },
      auth.userId
    );
    if (posting.error) return { status: "error", message: `${await t("payroll.error.run_failed")}${posting.error}` };
  }

  revalidatePath("/admin/payroll");
  revalidatePath("/admin/finance");
  return { status: "success" };
}

// Built inside the action (not at module scope) — see buildCreateStaffPayslipSchema's note above.
async function buildUpdateStaffPayslipSchema() {
  return z.object({
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, await t("payroll.error.invalid_period")),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, await t("payroll.error.invalid_period")),
    gross_amount: z.coerce.number().positive(await t("payroll.staff.error.invalid_amount")),
    description: z.string().trim().optional(),
  });
}

export type UpdateStaffPayslipState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

// Scoped to amount/period/description — party_id/document_type define what
// the document fundamentally IS, so changing either is a delete-and-recreate,
// not an edit. Once a row has posted to the ledger (a 'payslip', always; an
// 'admin_fee', once paid), amount/period changes are refused — editing them
// in place would silently desync the posted journal_lines amount from the
// row, same restriction updateExpenseDescription applies to operating
// expenses. Delete-then-recreate (which voids the old entry) is the correct
// path for a posted row's amount being wrong.
export async function updateStaffPayslip(payslipId: string, _prev: UpdateStaffPayslipState, formData: FormData): Promise<UpdateStaffPayslipState> {
  const auth = await requireFinanceUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const schema = await buildUpdateStaffPayslipSchema();
  const parsed = schema.safeParse({
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

  if (await isStaffPayslipPosted(admin, payslipId)) {
    const { data: current } = await admin.from("staff_payslips").select("period_start, period_end, gross_amount").eq("id", payslipId).maybeSingle();
    if (
      current &&
      (current.period_start !== input.period_start || current.period_end !== input.period_end || Number(current.gross_amount) !== input.gross_amount)
    ) {
      return { status: "error", message: await t("payroll.staff.error.already_posted") };
    }
  }

  const { error } = await admin
    .from("staff_payslips")
    .update({
      period_start: input.period_start,
      period_end: input.period_end,
      gross_amount: input.gross_amount,
      description: input.description ?? null,
    })
    .eq("id", payslipId);
  if (error) return { status: "error", message: `${await t("payroll.error.run_failed")}${error.message}` };

  revalidatePath("/admin/payroll");
  return { status: "success" };
}

export type DeleteStaffPayslipState = { ok: boolean; message: string };

// Voids the posted ledger entry first (if one exists) via
// void_staff_payslip_entry (migration 074 — same reversal-entry pattern as
// void_manual_expense), then removes the staff_payslips row. An unposted
// row (an unpaid admin_fee) has nothing to void, so this is a plain delete
// in that case, same as before migration 074.
export async function deleteStaffPayslip(payslipId: string): Promise<DeleteStaffPayslipState> {
  const auth = await requireFinanceUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();

  const { data: entry } = await admin
    .from("journal_entries")
    .select("id")
    .eq("source_type", "staff_payslip")
    .eq("source_id", payslipId)
    .neq("status", "voided")
    .maybeSingle();
  if (entry) {
    const { error: voidError } = await admin.rpc("void_staff_payslip_entry", { p_journal_entry_id: entry.id, p_posted_by: auth.userId });
    if (voidError) return { ok: false, message: `${await t("payroll.error.run_failed")}${voidError.message}` };
  }

  const { error } = await admin.from("staff_payslips").delete().eq("id", payslipId);
  if (error) return { ok: false, message: `${await t("payroll.error.run_failed")}${error.message}` };

  revalidatePath("/admin/payroll");
  revalidatePath("/admin/finance");
  return { ok: true, message: await t("payroll.staff.delete_success") };
}

export type MarkPaidState = { ok: boolean; message: string };

// Posts to the real ledger (migration 074) the moment an admin_fee is
// actually collected — Dr 1000 Cash / Cr 4900 Admin Fee Recovery, kept
// separate from real customer revenue (4000/4100) in the P&L breakdown.
export async function markStaffPayslipPaid(payslipId: string): Promise<MarkPaidState> {
  const auth = await requireFinanceUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("staff_payslips")
    .select("party_id, document_type, gross_amount, description, period_end, paid_at")
    .eq("id", payslipId)
    .maybeSingle();
  if (!existing) return { ok: false, message: await t("payroll.staff.error.not_found") };
  if (existing.paid_at) return { ok: true, message: await t("payroll.staff.already_paid") };

  // Post to the ledger BEFORE flipping paid_at — if this fails, the row
  // must stay unpaid so a retry can post it cleanly. Doing it the other way
  // around would let a failed posting leave the row permanently "paid" with
  // no ledger entry and no way back in, since the next call would just hit
  // the already_paid short-circuit above.
  const posting = await postStaffPayslipEntry(
    admin,
    {
      id: payslipId,
      document_type: existing.document_type === "admin_fee" ? "admin_fee" : "payslip",
      gross_amount: Number(existing.gross_amount),
      description: existing.description,
      party_id: existing.party_id,
      period_end: existing.period_end,
    },
    auth.userId
  );
  if (posting.error) return { ok: false, message: `${await t("payroll.error.run_failed")}${posting.error}` };

  const receiptNo = `RCP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(16).slice(2, 8)}`;
  const { error } = await admin
    .from("staff_payslips")
    .update({ paid_at: new Date().toISOString(), receipt_no: receiptNo })
    .eq("id", payslipId);
  if (error) return { ok: false, message: `${await t("payroll.error.run_failed")}${error.message}` };

  revalidatePath("/admin/payroll");
  revalidatePath("/admin/finance");
  return { ok: true, message: await t("payroll.staff.mark_paid_success") };
}

// Built inside the action (not at module scope) — see buildCreateStaffPayslipSchema's note above.
async function buildAddStaffMemberSchema() {
  return z.object({
    full_name: z.string().trim().min(2, await t("payroll.staff.error.invalid_name")),
  });
}

export type AddStaffMemberState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

// Registers a bare identity (parties + individuals, no users/auth login) so
// pure back-office staff who'll never sign into the portal can still appear
// in the staff-payslip recipient dropdown — see migration 072's header.
export async function addStaffMember(_prev: AddStaffMemberState, formData: FormData): Promise<AddStaffMemberState> {
  const auth = await requireFinanceUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const schema = await buildAddStaffMemberSchema();
  const parsed = schema.safeParse({ full_name: formData.get("full_name") });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? await t("payroll.staff.error.invalid_name") };
  }

  const admin = createAdminClient();
  const { data: party, error: partyError } = await admin.from("parties").insert({ party_type: "individual" }).select("id").single();
  if (partyError) return { status: "error", message: `${await t("payroll.error.run_failed")}${partyError.message}` };

  const { error: individualError } = await admin.from("individuals").insert({ party_id: party.id, full_name: parsed.data.full_name });
  if (individualError) return { status: "error", message: `${await t("payroll.error.run_failed")}${individualError.message}` };

  const { error: staffError } = await admin.from("staff_members").insert({ party_id: party.id });
  if (staffError) return { status: "error", message: `${await t("payroll.error.run_failed")}${staffError.message}` };

  revalidatePath("/admin/payroll");
  return { status: "success" };
}
