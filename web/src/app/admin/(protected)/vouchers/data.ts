import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface MyVoucherRow {
  id: string;
  voucher_type: "self_use" | "resale";
  status: "locked" | "issued" | "redeemed" | "expired";
  issued_at: string;
  redeemed_at: string | null;
}

// A new analyst's registration kit includes both a self_use and a resale
// voucher (registration_kits.voucher_self_use_count/voucher_resale_count,
// created at approval time in registrations/actions.ts). This is the
// analyst's own read of their detection_vouchers rows — the actual
// self_use/resale mechanics (report-form checkbox vs. Sales Orders'
// redeem_voucher mode) already exist elsewhere; this page is just a single
// place that shows both vouchers' status and points to the right flow.
export async function listMyVouchers(analystId: string): Promise<MyVoucherRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("detection_vouchers")
    .select("id, voucher_type, status, issued_at, redeemed_at")
    .eq("analyst_id", analystId)
    .order("issued_at", { ascending: true });
  return (data ?? []) as MyVoucherRow[];
}
