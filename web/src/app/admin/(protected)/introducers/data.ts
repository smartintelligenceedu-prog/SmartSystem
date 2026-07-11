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
    .select("id, party_id, referral_code, status")
    .order("created_at", { ascending: false });
  if (!introducers || introducers.length === 0) return [];

  const partyIds = introducers.map((i) => i.party_id);
  const [{ data: identities }, { data: users }, { data: customerCounts }, { data: commissions }] = await Promise.all([
    admin.from("individuals").select("party_id, full_name, email, phone").in("party_id", partyIds),
    admin.from("users").select("id, party_id").in("party_id", partyIds),
    admin.from("customers").select("acquired_via_introducer_id").in("acquired_via_introducer_id", introducers.map((i) => i.id)),
    admin.from("commission_records").select("introducer_id, commission_amount").in("introducer_id", introducers.map((i) => i.id)),
  ]);

  const identityByParty = new Map((identities ?? []).map((i) => [i.party_id, i]));
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
    return {
      introducer_id: i.id,
      party_id: i.party_id,
      full_name: identity?.full_name ?? "—",
      email: identity?.email ?? null,
      phone: identity?.phone ?? null,
      referral_code: i.referral_code,
      status: i.status as "active" | "inactive",
      has_login: partyIdsWithLogin.has(i.party_id),
      total_introduced_customers: customerCountByIntroducer.get(i.id) ?? 0,
      total_bonus: bonusByIntroducer.get(i.id) ?? 0,
    };
  });
}
