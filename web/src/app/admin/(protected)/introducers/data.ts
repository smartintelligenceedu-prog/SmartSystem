import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface IntroducerRow {
  introducer_id: string;
  party_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  referral_code: string;
  status: "active" | "inactive";
  has_login: boolean;
  sponsor_name: string | null;
  total_introduced_customers: number;
  total_bonus: number;
}

// No direct foreign key between introducers and individuals (both point at
// parties) — same reasoning as analysts <-> individuals elsewhere in this
// codebase, so this is built from flat queries merged in application code.
export async function listIntroducers(): Promise<IntroducerRow[]> {
  const admin = createAdminClient();

  const { data: introducers } = await admin
    .from("introducers")
    .select("id, party_id, sponsor_id, referral_code, status")
    .order("created_at", { ascending: false });
  if (!introducers || introducers.length === 0) return [];

  const partyIds = introducers.map((i) => i.party_id);
  const sponsorIds = [...new Set(introducers.filter((i) => i.sponsor_id).map((i) => i.sponsor_id as string))];

  const [{ data: identities }, { data: users }, { data: customerCounts }, { data: commissions }, { data: sponsors }] = await Promise.all([
    admin.from("individuals").select("party_id, full_name, email, phone").in("party_id", partyIds),
    admin.from("users").select("id, party_id").in("party_id", partyIds),
    admin.from("customers").select("acquired_via_introducer_id").in("acquired_via_introducer_id", introducers.map((i) => i.id)),
    admin.from("commission_records").select("introducer_id, commission_amount").in("introducer_id", introducers.map((i) => i.id)),
    sponsorIds.length > 0 ? admin.from("introducers").select("id, party_id").in("id", sponsorIds) : Promise.resolve({ data: [] }),
  ]);

  const sponsorPartyById = new Map((sponsors ?? []).map((s) => [s.id, s.party_id]));
  const identityByParty = new Map((identities ?? []).map((i) => [i.party_id, i]));
  // sponsors' identities may not be in the first identities fetch if a sponsor's own party_id wasn't in partyIds — refetch if needed
  const missingSponsorPartyIds = [...sponsorPartyById.values()].filter((pid) => !identityByParty.has(pid));
  if (missingSponsorPartyIds.length > 0) {
    const { data: extra } = await admin.from("individuals").select("party_id, full_name, email, phone").in("party_id", missingSponsorPartyIds);
    for (const e of extra ?? []) identityByParty.set(e.party_id, e);
  }

  const partyIdsWithLogin = new Set((users ?? []).map((u) => u.party_id));

  const customerCountByIntroducer = new Map<string, number>();
  for (const c of customerCounts ?? []) {
    const id = c.acquired_via_introducer_id as string;
    customerCountByIntroducer.set(id, (customerCountByIntroducer.get(id) ?? 0) + 1);
  }

  const bonusByIntroducer = new Map<string, number>();
  for (const c of commissions ?? []) {
    const id = c.introducer_id as string;
    bonusByIntroducer.set(id, (bonusByIntroducer.get(id) ?? 0) + Number(c.commission_amount));
  }

  return introducers.map((i) => {
    const identity = identityByParty.get(i.party_id);
    const sponsorParty = i.sponsor_id ? sponsorPartyById.get(i.sponsor_id) : null;
    const sponsorIdentity = sponsorParty ? identityByParty.get(sponsorParty) : null;
    return {
      introducer_id: i.id,
      party_id: i.party_id,
      full_name: identity?.full_name ?? "—",
      email: identity?.email ?? null,
      phone: identity?.phone ?? null,
      referral_code: i.referral_code,
      status: i.status as "active" | "inactive",
      has_login: partyIdsWithLogin.has(i.party_id),
      sponsor_name: sponsorIdentity?.full_name ?? null,
      total_introduced_customers: customerCountByIntroducer.get(i.id) ?? 0,
      total_bonus: bonusByIntroducer.get(i.id) ?? 0,
    };
  });
}

export async function listActiveIntroducersForSponsorPicker(): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  const { data: introducers } = await admin.from("introducers").select("id, party_id").eq("status", "active");
  if (!introducers || introducers.length === 0) return [];
  const { data: identities } = await admin.from("individuals").select("party_id, full_name").in("party_id", introducers.map((i) => i.party_id));
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));
  return introducers.map((i) => ({ id: i.id, name: nameByParty.get(i.party_id) ?? "—" }));
}
