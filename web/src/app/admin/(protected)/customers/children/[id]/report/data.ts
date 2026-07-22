import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { BRAIN_ZONES, type BrainZoneField, type ZoneCategory } from "./brain-zones";

export interface ChildContext {
  // Migration 028 — null when the subject is the customer themselves
  // (adult self-assessment), not a customer_children row.
  child_id: string | null;
  child_name: string;
  date_of_birth: string | null;
  customer_id: string;
  customer_name: string;
  owner_analyst_id: string;
  tags: string[];
  is_self: boolean;
}

export async function getChildContext(childId: string): Promise<ChildContext | null> {
  const admin = createAdminClient();

  const { data: child } = await admin
    .from("customer_children")
    .select("id, full_name, date_of_birth, customer_id, tags")
    .eq("id", childId)
    .maybeSingle();
  if (!child) return null;

  const { data: customer } = await admin.from("customers").select("id, party_id, owner_analyst_id").eq("id", child.customer_id).maybeSingle();
  if (!customer) return null;

  const { data: identity } = await admin.from("individuals").select("full_name").eq("party_id", customer.party_id).maybeSingle();

  return {
    child_id: child.id,
    child_name: child.full_name,
    date_of_birth: child.date_of_birth,
    customer_id: customer.id,
    customer_name: identity?.full_name ?? "—",
    owner_analyst_id: customer.owner_analyst_id,
    tags: child.tags ?? [],
    is_self: false,
  };
}

// Migration 028 — same shape as getChildContext(), but for a customer
// assessed directly. subject_name/child_name is the customer's own name;
// date of birth comes from their individuals row (customer_children has its
// own date_of_birth column, but an adult customer's lives on individuals).
export async function getCustomerSelfContext(customerId: string): Promise<ChildContext | null> {
  const admin = createAdminClient();

  const { data: customer } = await admin.from("customers").select("id, party_id, owner_analyst_id, tags").eq("id", customerId).maybeSingle();
  if (!customer) return null;

  const { data: identity } = await admin.from("individuals").select("full_name, date_of_birth").eq("party_id", customer.party_id).maybeSingle();

  return {
    child_id: null,
    child_name: identity?.full_name ?? "—",
    date_of_birth: identity?.date_of_birth ?? null,
    customer_id: customer.id,
    customer_name: identity?.full_name ?? "—",
    owner_analyst_id: customer.owner_analyst_id,
    tags: customer.tags ?? [],
    is_self: true,
  };
}

// How many self-use detection vouchers this analyst can still redeem — shown
// as an optional checkbox on the report form (Stage 2). Deliberately not
// wired into the schedule form (Stage 1): a booking can be cancelled or
// rescheduled, so the voucher is only spent once a report is actually saved.
export async function countAvailableSelfUseVouchers(analystId: string): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("detection_vouchers")
    .select("id", { count: "exact", head: true })
    .eq("analyst_id", analystId)
    .eq("voucher_type", "self_use")
    .eq("status", "issued");
  return count ?? 0;
}

export type OnePageReport = {
  id: string;
  recorded_at: string;
  left_brain_pct: number;
  right_brain_pct: number;
  personality_type: string;
  tqc_activity_score: number;
  learning_styles: string[];
  analyst_summary: string | null;
  // Missing entries mean "nobody classified this zone manually" — the view
  // falls back to the same auto strength/weakness split the form suggests,
  // so old rows (pre-migration-036, always '{}') still render sensibly.
  zone_categories: Partial<Record<BrainZoneField, ZoneCategory>>;
} & Record<BrainZoneField, number>;

const SELECT_COLUMNS = [
  "id",
  "recorded_at",
  "left_brain_pct",
  "right_brain_pct",
  "personality_type",
  "tqc_activity_score",
  "learning_styles",
  "analyst_summary",
  "zone_categories",
  ...BRAIN_ZONES.map((z) => z.field),
].join(", ");

async function getLatestOnePageReportBy(filter: { child_id: string } | { customer_id_self: string }): Promise<OnePageReport | null> {
  const admin = createAdminClient();
  let query = admin.from("tqc_one_page_reports").select(SELECT_COLUMNS);
  query = "child_id" in filter ? query.eq("child_id", filter.child_id) : query.eq("customer_id", filter.customer_id_self).is("child_id", null);
  const { data } = await query.order("recorded_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;

  const row = data as unknown as Record<string, unknown>;
  const result: Record<string, unknown> = {
    id: row.id,
    recorded_at: row.recorded_at,
    left_brain_pct: Number(row.left_brain_pct),
    right_brain_pct: Number(row.right_brain_pct),
    personality_type: row.personality_type,
    tqc_activity_score: Number(row.tqc_activity_score),
    learning_styles: row.learning_styles ?? [],
    analyst_summary: row.analyst_summary,
    zone_categories: (row.zone_categories as Partial<Record<BrainZoneField, ZoneCategory>>) ?? {},
  };
  for (const zone of BRAIN_ZONES) {
    result[zone.field] = Number(row[zone.field]);
  }
  return result as OnePageReport;
}

export function getLatestOnePageReport(childId: string): Promise<OnePageReport | null> {
  return getLatestOnePageReportBy({ child_id: childId });
}

// Migration 028 — same as getLatestOnePageReport() but for a customer
// assessed directly.
export function getLatestOnePageReportForCustomerSelf(customerId: string): Promise<OnePageReport | null> {
  return getLatestOnePageReportBy({ customer_id_self: customerId });
}
