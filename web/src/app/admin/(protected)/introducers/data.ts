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
  assigned_analyst_id: string | null;
  assigned_analyst_name: string | null;
}

// No direct foreign key between introducers and individuals (both point at
// parties) — same reasoning as analysts <-> individuals elsewhere in this
// codebase, so this is built from flat queries merged in application code.
export async function listIntroducers(): Promise<IntroducerRow[]> {
  const admin = createAdminClient();

  const { data: introducers } = await admin
    .from("introducers")
    .select("id, party_id, sponsor_id, referral_code, status, assigned_analyst_id")
    .order("created_at", { ascending: false });
  if (!introducers || introducers.length === 0) return [];

  const partyIds = introducers.map((i) => i.party_id);
  const sponsorIds = [...new Set(introducers.filter((i) => i.sponsor_id).map((i) => i.sponsor_id as string))];
  const assignedAnalystIds = [...new Set(introducers.filter((i) => i.assigned_analyst_id).map((i) => i.assigned_analyst_id as string))];

  const [{ data: identities }, { data: users }, { data: customerCounts }, { data: commissions }, { data: sponsors }, { data: assignedAnalysts }] =
    await Promise.all([
      admin.from("individuals").select("party_id, full_name, email, phone").in("party_id", partyIds),
      admin.from("users").select("id, party_id").in("party_id", partyIds),
      admin.from("customers").select("acquired_via_introducer_id").in("acquired_via_introducer_id", introducers.map((i) => i.id)),
      admin.from("commission_records").select("introducer_id, commission_amount").in("introducer_id", introducers.map((i) => i.id)),
      sponsorIds.length > 0 ? admin.from("introducers").select("id, party_id").in("id", sponsorIds) : Promise.resolve({ data: [] }),
      assignedAnalystIds.length > 0 ? admin.from("analysts").select("id, party_id").in("id", assignedAnalystIds) : Promise.resolve({ data: [] }),
    ]);

  const sponsorPartyById = new Map((sponsors ?? []).map((s) => [s.id, s.party_id]));
  const analystPartyById = new Map((assignedAnalysts ?? []).map((a) => [a.id, a.party_id]));
  const identityByParty = new Map((identities ?? []).map((i) => [i.party_id, i]));
  // sponsors'/assigned analysts' identities may not be in the first identities
  // fetch if their own party_id wasn't in partyIds — refetch if needed
  const missingPartyIds = [...new Set([...sponsorPartyById.values(), ...analystPartyById.values()])].filter((pid) => !identityByParty.has(pid));
  if (missingPartyIds.length > 0) {
    const { data: extra } = await admin.from("individuals").select("party_id, full_name, email, phone").in("party_id", missingPartyIds);
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
    const analystParty = i.assigned_analyst_id ? analystPartyById.get(i.assigned_analyst_id) : null;
    const analystIdentity = analystParty ? identityByParty.get(analystParty) : null;
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
      assigned_analyst_id: i.assigned_analyst_id,
      assigned_analyst_name: analystIdentity?.full_name ?? null,
    };
  });
}

// For the "负责分析师" picker — approved analysts only, same shape as other
// id/name pickers in this codebase.
export async function listApprovedAnalystsForAssignment(): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  const { data: analysts } = await admin.from("analysts").select("id, party_id").eq("status", "approved");
  if (!analysts || analysts.length === 0) return [];
  const { data: identities } = await admin.from("individuals").select("party_id, full_name").in("party_id", analysts.map((a) => a.party_id));
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));
  return analysts.map((a) => ({ id: a.id, name: nameByParty.get(a.party_id) ?? "—" })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listActiveIntroducersForSponsorPicker(): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  const { data: introducers } = await admin.from("introducers").select("id, party_id").eq("status", "active");
  if (!introducers || introducers.length === 0) return [];
  const { data: identities } = await admin.from("individuals").select("party_id, full_name").in("party_id", introducers.map((i) => i.party_id));
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));
  return introducers.map((i) => ({ id: i.id, name: nameByParty.get(i.party_id) ?? "—" }));
}
