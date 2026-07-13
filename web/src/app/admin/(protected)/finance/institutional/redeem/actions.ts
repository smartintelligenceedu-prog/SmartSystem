"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { searchCustomerChildren, type ChildSearchResult } from "./data";

// Redemption is a front-line action (an assessor scanning/typing a code
// while a child is physically present for detection), not a back-office-only
// one — so the gate here is "logged in with a role" (has an analyst record,
// or is back office), mirroring reports/actions.ts's requireCallerContext()
// rather than the back-office-only gate used by invoices/payments actions.
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

export async function searchChildrenAction(query: string): Promise<ChildSearchResult[]> {
  const auth = await requireCallerContext();
  if ("error" in auth) return [];
  if (!auth.isBackOffice && !auth.analystId) return [];
  return searchCustomerChildren(query);
}

export type RedeemVoucherResult = { ok: true; message: string } | { ok: false; errorKey: string };

export async function redeemVoucher(voucherCode: string, childId: string): Promise<RedeemVoucherResult> {
  const auth = await requireCallerContext();
  if ("error" in auth) return { ok: false, errorKey: "finance.institutional.voucher.error.not_authenticated" };
  if (!auth.isBackOffice && !auth.analystId) return { ok: false, errorKey: "finance.institutional.voucher.error.no_permission" };

  const code = voucherCode.trim().toUpperCase();
  if (!code) return { ok: false, errorKey: "finance.institutional.voucher.error.code_required" };
  if (!childId) return { ok: false, errorKey: "finance.institutional.voucher.error.child_required" };

  const admin = createAdminClient();

  const { data: voucher } = await admin.from("institutional_vouchers").select("id, status").eq("voucher_code", code).maybeSingle();
  if (!voucher) return { ok: false, errorKey: "finance.institutional.voucher.error.not_found" };
  if (voucher.status === "used") return { ok: false, errorKey: "finance.institutional.voucher.error.already_used" };
  if (voucher.status === "cancelled") return { ok: false, errorKey: "finance.institutional.voucher.error.cancelled" };

  const { data: child } = await admin.from("customer_children").select("id").eq("id", childId).maybeSingle();
  if (!child) return { ok: false, errorKey: "finance.institutional.voucher.error.child_not_found" };

  // Guard against a redeem-twice race: only flip rows that are still
  // 'unused' at the moment of the UPDATE, not just at the SELECT above.
  const { data: updated, error } = await admin
    .from("institutional_vouchers")
    .update({ status: "used", used_by_child_id: childId, used_at: new Date().toISOString() })
    .eq("id", voucher.id)
    .eq("status", "unused")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, errorKey: "finance.institutional.voucher.error.redeem_failed" };
  if (!updated) return { ok: false, errorKey: "finance.institutional.voucher.error.already_used" };

  revalidatePath("/admin/finance/institutional");
  revalidatePath("/admin/finance/institutional/redeem");
  return { ok: true, message: "" };
}
