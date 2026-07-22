import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export interface LeadRow {
  id: string;
  contact_name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  status: "new" | "contacted" | "converted" | "lost";
  introducer_id: string | null;
  introducer_name: string | null;
  assigned_analyst_id: string | null;
  assigned_analyst_name: string | null;
  converted_customer_id: string | null;
  created_at: string;
}

// Self-scope (analyst) reads through their own RLS session — leads has a
// select policy for assigned_analyst_id = current_analyst_id(), same
// "self client for base rows, admin client only for id-keyed name lookups"
// split used in customers/data.ts.
export async function listLeads(isBackOffice: boolean): Promise<LeadRow[]> {
  const selfClient = await createServerSupabaseClient();
  const client = isBackOffice ? createAdminClient() : selfClient;

  // Converted leads are done — the resulting customer record (via
  // converted_customer_id) is now the source of truth for that person, so
  // they're excluded here rather than lingering in the working list.
  const { data: leads } = await client
    .from("leads")
    .select("id, contact_name, phone, email, source, status, introducer_id, assigned_analyst_id, converted_customer_id, created_at")
    .neq("status", "converted")
    .order("created_at", { ascending: false });
  if (!leads || leads.length === 0) return [];

  const introducerIds = [...new Set(leads.filter((l) => l.introducer_id).map((l) => l.introducer_id as string))];
  const analystIds = [...new Set(leads.filter((l) => l.assigned_analyst_id).map((l) => l.assigned_analyst_id as string))];

  const admin = createAdminClient();
  const [{ data: introducers }, { data: analysts }] = await Promise.all([
    introducerIds.length > 0 ? admin.from("introducers").select("id, party_id").in("id", introducerIds) : Promise.resolve({ data: [] }),
    analystIds.length > 0 ? admin.from("analysts").select("id, party_id").in("id", analystIds) : Promise.resolve({ data: [] }),
  ]);

  const introducerPartyById = new Map((introducers ?? []).map((i) => [i.id, i.party_id]));
  const analystPartyById = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));
  const partyIds = [...new Set([...introducerPartyById.values(), ...analystPartyById.values()])];
  const { data: identities } = partyIds.length > 0 ? await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds) : { data: [] };
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));

  return leads.map((l) => {
    const introducerParty = l.introducer_id ? introducerPartyById.get(l.introducer_id) : null;
    const analystParty = l.assigned_analyst_id ? analystPartyById.get(l.assigned_analyst_id) : null;
    return {
      id: l.id,
      contact_name: l.contact_name,
      phone: l.phone,
      email: l.email,
      source: l.source,
      status: l.status as LeadRow["status"],
      introducer_id: l.introducer_id,
      introducer_name: introducerParty ? (nameByParty.get(introducerParty) ?? null) : null,
      assigned_analyst_id: l.assigned_analyst_id,
      assigned_analyst_name: analystParty ? (nameByParty.get(analystParty) ?? null) : null,
      converted_customer_id: l.converted_customer_id,
      created_at: l.created_at,
    };
  });
}

// For customers/new/page.tsx's ?lead_id= prefill flow — reads through the
// caller's own RLS session so an analyst can only prefill from a lead
// actually assigned to them (back office can prefill from any lead).
export async function getLeadForConversion(leadId: string): Promise<{
  id: string;
  contact_name: string;
  phone: string | null;
  introducer_id: string | null;
  status: string;
} | null> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("leads").select("id, contact_name, phone, introducer_id, status").eq("id", leadId).maybeSingle();
  return data ?? null;
}
