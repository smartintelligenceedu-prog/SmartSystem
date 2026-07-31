import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicVoucherImageUrl } from "@/lib/storage";

export interface MarketingVoucherRow {
  id: string;
  title: string;
  image_url: string;
  terms: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

// Back office management list — every voucher, active or not.
export async function listMarketingVouchers(): Promise<MarketingVoucherRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("marketing_vouchers")
    .select("id, title, image_path, terms, is_active, sort_order, created_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  return (data ?? []).map((v) => ({
    id: v.id,
    title: v.title,
    image_url: getPublicVoucherImageUrl(v.image_path),
    terms: v.terms,
    is_active: v.is_active,
    sort_order: v.sort_order,
    created_at: v.created_at,
  }));
}

// Introducer-facing gallery — active vouchers only.
export async function listActiveMarketingVouchers(): Promise<MarketingVoucherRow[]> {
  const rows = await listMarketingVouchers();
  return rows.filter((v) => v.is_active);
}
