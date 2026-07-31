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

export interface MarketingVoucherDetail extends MarketingVoucherRow {
  // Only meaningful when fetched for a specific introducer — null for a
  // back-office viewer (there's no "self" redemption concept for them).
  redeemed_at: string | null;
}

// `introducerId` is the CURRENT viewer's own introducer id (or null for
// back office) — resolves whether THEY have already redeemed this voucher,
// not a global redemption count.
export async function getMarketingVoucherDetail(id: string, introducerId: string | null): Promise<MarketingVoucherDetail | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("marketing_vouchers")
    .select("id, title, image_path, terms, is_active, sort_order, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;

  let redeemedAt: string | null = null;
  if (introducerId) {
    const { data: redemption } = await admin
      .from("marketing_voucher_redemptions")
      .select("redeemed_at")
      .eq("voucher_id", id)
      .eq("introducer_id", introducerId)
      .maybeSingle();
    redeemedAt = redemption?.redeemed_at ?? null;
  }

  return {
    id: data.id,
    title: data.title,
    image_url: getPublicVoucherImageUrl(data.image_path),
    terms: data.terms,
    is_active: data.is_active,
    sort_order: data.sort_order,
    created_at: data.created_at,
    redeemed_at: redeemedAt,
  };
}
