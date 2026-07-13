import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface AgentInstitutionalStats {
  voucher_total: number;
  voucher_used: number;
  institution_count: number;
  assessed_children_count: number;
  new_children_this_month: number;
}

// institutional_vouchers is back-office-only under RLS (see
// rls_policies.sql's "back office only" block), so an Agent's own session
// can't read it directly — this uses the admin client instead, but every
// query below is scoped by the caller's own analystId (read from the
// authenticated session via getPortalUserContext() in the page, not
// user-supplied), so it never exposes another agent's data.
export async function getAgentInstitutionalStats(analystId: string): Promise<AgentInstitutionalStats> {
  const admin = createAdminClient();

  const { data: items } = await admin.from("order_items").select("order_id").eq("analyst_id", analystId);
  const orderIds = [...new Set((items ?? []).map((it) => it.order_id))];

  const { data: customers } = await admin.from("customers").select("id").eq("owner_analyst_id", analystId);
  const customerIds = (customers ?? []).map((c) => c.id);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [{ data: orders }, { data: vouchers }, { data: children }] = await Promise.all([
    orderIds.length > 0
      ? admin.from("orders").select("id, institution_party_id").in("id", orderIds).eq("billing_mode", "invoice")
      : Promise.resolve({ data: [] as { id: string; institution_party_id: string | null }[] }),
    orderIds.length > 0 ? admin.from("institutional_vouchers").select("order_id, status").in("order_id", orderIds) : Promise.resolve({ data: [] }),
    customerIds.length > 0 ? admin.from("customer_children").select("id, created_at").in("customer_id", customerIds) : Promise.resolve({ data: [] }),
  ]);

  const institutionalOrderIds = new Set((orders ?? []).map((o) => o.id));
  const relevantVouchers = (vouchers ?? []).filter((v) => institutionalOrderIds.has(v.order_id));
  const institutionCount = new Set((orders ?? []).map((o) => o.institution_party_id).filter((id): id is string => !!id)).size;

  const childIds = (children ?? []).map((c) => c.id);
  const { data: reports } =
    childIds.length > 0 ? await admin.from("tqc_one_page_reports").select("child_id").in("child_id", childIds) : { data: [] };
  const assessedChildrenCount = new Set((reports ?? []).map((r) => r.child_id)).size;

  const newChildrenThisMonth = (children ?? []).filter((c) => c.created_at >= monthStart).length;

  return {
    voucher_total: relevantVouchers.length,
    voucher_used: relevantVouchers.filter((v) => v.status === "used").length,
    institution_count: institutionCount,
    assessed_children_count: assessedChildrenCount,
    new_children_this_month: newChildrenThisMonth,
  };
}

export interface FollowUpChild {
  child_id: string;
  full_name: string;
  tags: string[];
  last_assessed_at: string;
  days_since_assessment: number;
}

const FOLLOW_UP_STALE_DAYS = 30;
const FOLLOW_UP_LIMIT = 10;

// "Recently uncontacted" has no dedicated data source in this system (no
// contact-log table) — recorded_at on the child's most recent TQC report is
// used as a practical stand-in signal: a tagged child who hasn't been
// reassessed in a while is exactly the kind of profile that should prompt a
// science-based-parenting follow-up visit.
export async function getFollowUpChildren(analystId: string): Promise<FollowUpChild[]> {
  const admin = createAdminClient();

  const { data: customers } = await admin.from("customers").select("id").eq("owner_analyst_id", analystId);
  const customerIds = (customers ?? []).map((c) => c.id);
  if (customerIds.length === 0) return [];

  const { data: children } = await admin.from("customer_children").select("id, full_name, tags").in("customer_id", customerIds);
  const taggedChildren = (children ?? []).filter((c) => (c.tags ?? []).length > 0);
  if (taggedChildren.length === 0) return [];

  const childIds = taggedChildren.map((c) => c.id);
  const { data: reports } = await admin.from("tqc_one_page_reports").select("child_id, recorded_at").in("child_id", childIds);

  const latestByChild = new Map<string, string>();
  for (const r of reports ?? []) {
    const existing = latestByChild.get(r.child_id);
    if (!existing || r.recorded_at > existing) latestByChild.set(r.child_id, r.recorded_at);
  }

  const now = Date.now();
  const staleMs = FOLLOW_UP_STALE_DAYS * 24 * 60 * 60 * 1000;

  return taggedChildren
    .map((c): FollowUpChild | null => {
      const lastAssessedAt = latestByChild.get(c.id);
      if (!lastAssessedAt) return null;
      const daysSince = Math.floor((now - new Date(lastAssessedAt).getTime()) / (24 * 60 * 60 * 1000));
      return { child_id: c.id, full_name: c.full_name, tags: c.tags ?? [], last_assessed_at: lastAssessedAt, days_since_assessment: daysSince };
    })
    .filter((c): c is FollowUpChild => !!c && now - new Date(c.last_assessed_at).getTime() >= staleMs)
    .sort((a, b) => b.days_since_assessment - a.days_since_assessment)
    .slice(0, FOLLOW_UP_LIMIT);
}
