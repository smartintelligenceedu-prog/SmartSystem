"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Same pattern as every other admin Server Action in this codebase: re-check
 * the caller's own session independently of the (protected) layout / page
 * gates. See the note in admin/registrations/actions.ts.
 */
async function requireBackOfficeUserId(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "请先登入" };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  if (!isBackOffice) return { error: "没有权限执行此操作" };

  const { data: userRow } = await supabase.from("users").select("id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: "找不到对应的后台使用者资料" };

  return { userId: userRow.id };
}

export async function adminAdjustCommission(
  recordId: string,
  newAmount: number,
  reason: string
): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  if (!Number.isFinite(newAmount) || newAmount < 0) return { ok: false, message: "请输入正确的金额" };
  if (!reason.trim()) return { ok: false, message: "请填写调整原因" };

  const admin = createAdminClient();

  const { data: record } = await admin
    .from("commission_records")
    .select("commission_amount, original_amount")
    .eq("id", recordId)
    .single();
  if (!record) return { ok: false, message: "找不到这笔佣金记录" };

  // original_amount is only ever set the first time a record is overridden,
  // so it always preserves what the engine originally computed — see the
  // note in commission_engine.sql.
  const { error } = await admin
    .from("commission_records")
    .update({
      original_amount: record.original_amount ?? record.commission_amount,
      commission_amount: newAmount,
      adjusted_by: auth.userId,
      adjusted_at: new Date().toISOString(),
      adjustment_reason: reason.trim(),
    })
    .eq("id", recordId);
  if (error) return { ok: false, message: `调整失败：${error.message}` };

  revalidatePath("/admin/commission");
  return { ok: true, message: "已调整佣金金额" };
}

// The pending -> approved step commission_engine.sql leaves as a manual SQL
// UPDATE (see the comment above calculate_report_override_commission) now has
// a real button here. Approval itself doesn't move money — it just marks the
// record as reviewed and eligible for the next monthly payout run (see
// runMonthlyPayout in payroll/actions.ts, which only ever pulls 'approved'
// records into a payslip/statement).
export async function adminApproveCommission(recordId: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("commission_records")
    .update({ status: "approved" })
    .eq("id", recordId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: `核准失败：${error.message}` };
  if (!data) return { ok: false, message: "这笔记录已经不是待处理状态，可能已被处理过了" };

  revalidatePath("/admin/commission");
  return { ok: true, message: "已核准" };
}
