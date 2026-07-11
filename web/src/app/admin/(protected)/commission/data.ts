import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CommissionRow {
  id: string;
  trigger_type: string;
  calculation_type: string;
  rate_applied: number | null;
  base_amount: number;
  commission_amount: number;
  original_amount: number | null;
  status: string;
  calculated_at: string;
  adjusted_at: string | null;
  adjustment_reason: string | null;
  payee_type: "analyst" | "introducer";
  payee_name: string;
}

const RECENT_LIMIT = 200;

// Back-office view: every commission record, most recent first. Payee name
// resolution follows the same "no direct FK, merge flat queries" pattern as
// listIntroducers() — analysts/introducers both point at parties, not at
// individuals directly.
export async function listAllCommissions(): Promise<CommissionRow[]> {
  const admin = createAdminClient();

  const { data: records } = await admin
    .from("commission_records")
    .select(
      "id, trigger_type, calculation_type, rate_applied, base_amount, commission_amount, original_amount, status, calculated_at, adjusted_at, adjustment_reason, analyst_id, introducer_id"
    )
    .order("calculated_at", { ascending: false })
    .limit(RECENT_LIMIT);
  if (!records || records.length === 0) return [];

  const analystIds = [...new Set(records.filter((r) => r.analyst_id).map((r) => r.analyst_id as string))];
  const introducerIds = [...new Set(records.filter((r) => r.introducer_id).map((r) => r.introducer_id as string))];

  const [{ data: analysts }, { data: introducers }] = await Promise.all([
    analystIds.length > 0 ? admin.from("analysts").select("id, party_id").in("id", analystIds) : Promise.resolve({ data: [] }),
    introducerIds.length > 0
      ? admin.from("introducers").select("id, party_id").in("id", introducerIds)
      : Promise.resolve({ data: [] }),
  ]);

  const partyIds = [...new Set([...(analysts ?? []).map((a) => a.party_id), ...(introducers ?? []).map((i) => i.party_id)])];
  const { data: identities } =
    partyIds.length > 0
      ? await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds)
      : { data: [] };
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));
  const partyByAnalyst = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));
  const partyByIntroducer = new Map((introducers ?? []).map((i) => [i.id, i.party_id]));

  return records.map((r) => {
    const isIntroducer = !!r.introducer_id;
    const partyId = isIntroducer ? partyByIntroducer.get(r.introducer_id as string) : partyByAnalyst.get(r.analyst_id as string);
    return {
      id: r.id,
      trigger_type: r.trigger_type,
      calculation_type: r.calculation_type,
      rate_applied: r.rate_applied,
      base_amount: Number(r.base_amount),
      commission_amount: Number(r.commission_amount),
      original_amount: r.original_amount === null ? null : Number(r.original_amount),
      status: r.status,
      calculated_at: r.calculated_at,
      adjusted_at: r.adjusted_at,
      adjustment_reason: r.adjustment_reason,
      payee_type: isIntroducer ? "introducer" : "analyst",
      payee_name: (partyId && nameByParty.get(partyId)) ?? "—",
    };
  });
}
