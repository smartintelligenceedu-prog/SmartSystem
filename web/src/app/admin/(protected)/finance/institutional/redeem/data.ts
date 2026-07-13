import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface ChildSearchResult {
  child_id: string;
  child_name: string;
  customer_name: string;
  date_of_birth: string | null;
}

// Cross-customer search (admin client, not scoped to the caller's own
// customers) — an institutional bulk-deal redemption can be for any child
// in the system, not just ones "owned" by whichever analyst is doing the
// redemption on the day, same reasoning as every other admin-client read in
// this codebase (permission is enforced by the calling Server
// Action/page, not by narrowing the query to the caller's own records).
export async function searchCustomerChildren(query: string): Promise<ChildSearchResult[]> {
  if (!query.trim()) return [];
  const admin = createAdminClient();

  const { data: children } = await admin
    .from("customer_children")
    .select("id, full_name, customer_id, date_of_birth")
    .ilike("full_name", `%${query.trim()}%`)
    .limit(20);
  if (!children || children.length === 0) return [];

  const customerIds = [...new Set(children.map((c) => c.customer_id))];
  const { data: customers } = await admin.from("customers").select("id, party_id").in("id", customerIds);
  const partyByCustomer = new Map((customers ?? []).map((c) => [c.id, c.party_id]));
  const partyIds = [...new Set([...partyByCustomer.values()])];
  const { data: identities } = partyIds.length > 0 ? await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds) : { data: [] };
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));

  return children.map((c) => {
    const party = partyByCustomer.get(c.customer_id);
    return {
      child_id: c.id,
      child_name: c.full_name,
      customer_name: (party && nameByParty.get(party)) ?? "—",
      date_of_birth: c.date_of_birth,
    };
  });
}
