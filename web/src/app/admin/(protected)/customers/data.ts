import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export interface CustomerRow {
  customer_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  status: string;
  owner_analyst_id: string;
  owner_name: string;
  introducer_name: string | null;
  order_count: number;
  total_spent: number;
  created_at: string;
}

// Self-scope callers read through their own RLS session (customers SELECT
// policy already scopes to owner_analyst_id = current_analyst_id() or back
// office); the merge lookups below use the admin client regardless, but only
// ever key off ids the caller's own customer rows already reference, so this
// never surfaces data beyond what the caller could already see.
export async function listCustomers(isBackOffice: boolean): Promise<CustomerRow[]> {
  const selfClient = await createServerSupabaseClient();
  const client = isBackOffice ? createAdminClient() : selfClient;

  const { data: customers } = await client
    .from("customers")
    .select("id, party_id, owner_analyst_id, acquired_via_introducer_id, status, created_at")
    .order("created_at", { ascending: false });
  if (!customers || customers.length === 0) return [];

  const partyIds = customers.map((c) => c.party_id);
  const analystIds = [...new Set(customers.map((c) => c.owner_analyst_id))];
  const introducerIds = [...new Set(customers.filter((c) => c.acquired_via_introducer_id).map((c) => c.acquired_via_introducer_id as string))];
  const customerIds = customers.map((c) => c.id);

  const admin = createAdminClient();
  const [{ data: analysts }, { data: introducers }, { data: orders }] = await Promise.all([
    admin.from("analysts").select("id, party_id").in("id", analystIds),
    introducerIds.length > 0 ? admin.from("introducers").select("id, party_id").in("id", introducerIds) : Promise.resolve({ data: [] }),
    admin.from("orders").select("customer_id, total_amount, status").in("customer_id", customerIds).eq("order_type", "detection_service"),
  ]);

  const analystPartyById = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));
  const introducerPartyById = new Map((introducers ?? []).map((i) => [i.id, i.party_id]));

  const identityPartyIds = [...new Set([...partyIds, ...analystPartyById.values(), ...introducerPartyById.values()])];
  const { data: identities } = await admin.from("individuals").select("party_id, full_name, phone, email").in("party_id", identityPartyIds);
  const identityByParty = new Map((identities ?? []).map((i) => [i.party_id, i]));

  const orderStatsByCustomer = new Map<string, { count: number; total: number }>();
  for (const o of orders ?? []) {
    const key = o.customer_id as string;
    const cur = orderStatsByCustomer.get(key) ?? { count: 0, total: 0 };
    cur.count += 1;
    if (o.status === "paid") cur.total += Number(o.total_amount);
    orderStatsByCustomer.set(key, cur);
  }

  return customers.map((c) => {
    const identity = identityByParty.get(c.party_id);
    const ownerParty = analystPartyById.get(c.owner_analyst_id);
    const ownerIdentity = ownerParty ? identityByParty.get(ownerParty) : null;
    const introducerParty = c.acquired_via_introducer_id ? introducerPartyById.get(c.acquired_via_introducer_id) : null;
    const introducerIdentity = introducerParty ? identityByParty.get(introducerParty) : null;
    const stats = orderStatsByCustomer.get(c.id) ?? { count: 0, total: 0 };

    return {
      customer_id: c.id,
      full_name: identity?.full_name ?? "—",
      phone: identity?.phone ?? null,
      email: identity?.email ?? null,
      status: c.status,
      owner_analyst_id: c.owner_analyst_id,
      owner_name: ownerIdentity?.full_name ?? "—",
      introducer_name: introducerIdentity?.full_name ?? null,
      order_count: stats.count,
      total_spent: stats.total,
      created_at: c.created_at,
    };
  });
}

export async function listActiveIntroducersForAttribution(): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  const { data: introducers } = await admin.from("introducers").select("id, party_id").eq("status", "active");
  if (!introducers || introducers.length === 0) return [];
  const { data: identities } = await admin
    .from("individuals")
    .select("party_id, full_name")
    .in("party_id", introducers.map((i) => i.party_id));
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));
  return introducers.map((i) => ({ id: i.id, name: nameByParty.get(i.party_id) ?? "—" }));
}
