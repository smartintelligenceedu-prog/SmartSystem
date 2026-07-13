import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { BRAIN_ZONES, type BrainZoneField } from "./brain-zones";

export interface ChildContext {
  child_id: string;
  child_name: string;
  date_of_birth: string | null;
  customer_id: string;
  customer_name: string;
  owner_analyst_id: string;
  tags: string[];
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
  };
}

export type OnePageReport = {
  id: string;
  recorded_at: string;
  left_brain_pct: number;
  right_brain_pct: number;
  personality_type: string;
  tqc_activity_score: number;
  tqc_stars: number;
  learning_styles: string[];
  analyst_summary: string | null;
} & Record<BrainZoneField, number>;

const SELECT_COLUMNS = [
  "id",
  "recorded_at",
  "left_brain_pct",
  "right_brain_pct",
  "personality_type",
  "tqc_activity_score",
  "tqc_stars",
  "learning_styles",
  "analyst_summary",
  ...BRAIN_ZONES.map((z) => z.field),
].join(", ");

export async function getLatestOnePageReport(childId: string): Promise<OnePageReport | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("tqc_one_page_reports")
    .select(SELECT_COLUMNS)
    .eq("child_id", childId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  const row = data as unknown as Record<string, unknown>;
  const result: Record<string, unknown> = {
    id: row.id,
    recorded_at: row.recorded_at,
    left_brain_pct: Number(row.left_brain_pct),
    right_brain_pct: Number(row.right_brain_pct),
    personality_type: row.personality_type,
    tqc_activity_score: Number(row.tqc_activity_score),
    tqc_stars: Number(row.tqc_stars),
    learning_styles: row.learning_styles ?? [],
    analyst_summary: row.analyst_summary,
  };
  for (const zone of BRAIN_ZONES) {
    result[zone.field] = Number(row[zone.field]);
  }
  return result as OnePageReport;
}
