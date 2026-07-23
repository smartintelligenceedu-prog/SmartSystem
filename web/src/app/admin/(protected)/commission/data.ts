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
  analyst_id: string | null;
  introducer_id: string | null;
  // Only populated for trigger_type = 'introducer' rows (commission_records.
  // customer_id, migration 035) — the customer whose visit earned this
  // referral fee, not the payee. prior_settlement_date is set when this
  // customer's phone number already has an earlier approved/paid introducer
  // commission under a DIFFERENT customer_id — the same signal the phone
  // duplicate guard in calculate_commissions_for_order() blocks on, surfaced
  // here so back office can see it even on rows the guard let through
  // before this migration, or during manual review.
  customer_name: string | null;
  customer_phone_masked: string | null;
  prior_settlement_date: string | null;
}

const RECENT_LIMIT = 200;

// For the "reassign to a different analyst" control — every approved
// analyst, name-resolved the same "no direct FK, merge flat queries" way as
// everything else in this file.
export async function listApprovedAnalystOptions(): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  const { data: analysts } = await admin.from("analysts").select("id, party_id").eq("status", "approved");
  if (!analysts || analysts.length === 0) return [];
  const partyIds = analysts.map((a) => a.party_id);
  const { data: identities } = await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds);
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));
  return analysts.map((a) => ({ id: a.id, name: nameByParty.get(a.party_id) ?? "—" }));
}

// e.g. "0123456789" -> "0123-***6789"; too-short/empty input is masked
// entirely rather than shown raw.
function maskPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.length <= 7) return "*".repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}-***${trimmed.slice(-4)}`;
}

// Back-office view: every commission record, most recent first. Payee name
// resolution follows the same "no direct FK, merge flat queries" pattern as
// listIntroducers() — analysts/introducers both point at parties, not at
// individuals directly.
export async function listAllCommissions(): Promise<CommissionRow[]> {
  const admin = createAdminClient();

  const { data: records } = await admin
    .from("commission_records")
    .select(
      "id, trigger_type, calculation_type, rate_applied, base_amount, commission_amount, original_amount, status, calculated_at, adjusted_at, adjustment_reason, analyst_id, introducer_id, customer_id"
    )
    .order("calculated_at", { ascending: false })
    .limit(RECENT_LIMIT);
  if (!records || records.length === 0) return [];

  const analystIds = [...new Set(records.filter((r) => r.analyst_id).map((r) => r.analyst_id as string))];
  const introducerIds = [...new Set(records.filter((r) => r.introducer_id).map((r) => r.introducer_id as string))];

  // Every approved/paid introducer commission ever calculated (not just the
  // RECENT_LIMIT window) — needed to find the earliest settlement date for
  // a phone number even when that earlier commission has scrolled off the
  // "most recent 200" list.
  const { data: priorIntroRecords } = await admin
    .from("commission_records")
    .select("customer_id, calculated_at")
    .eq("trigger_type", "introducer")
    .in("status", ["approved", "paid"])
    .not("customer_id", "is", null);

  const visibleCustomerIds = records.filter((r) => r.customer_id).map((r) => r.customer_id as string);
  const priorCustomerIds = (priorIntroRecords ?? []).map((r) => r.customer_id as string);
  const allCustomerIds = [...new Set([...visibleCustomerIds, ...priorCustomerIds])];

  const [{ data: analysts }, { data: introducers }, { data: customers }] = await Promise.all([
    analystIds.length > 0 ? admin.from("analysts").select("id, party_id").in("id", analystIds) : Promise.resolve({ data: [] }),
    introducerIds.length > 0
      ? admin.from("introducers").select("id, party_id").in("id", introducerIds)
      : Promise.resolve({ data: [] }),
    allCustomerIds.length > 0 ? admin.from("customers").select("id, party_id").in("id", allCustomerIds) : Promise.resolve({ data: [] }),
  ]);

  const partyIds = [
    ...new Set([...(analysts ?? []).map((a) => a.party_id), ...(introducers ?? []).map((i) => i.party_id), ...(customers ?? []).map((c) => c.party_id)]),
  ];
  const { data: identities } =
    partyIds.length > 0
      ? await admin.from("individuals").select("party_id, full_name, phone").in("party_id", partyIds)
      : { data: [] };
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));
  const phoneByParty = new Map((identities ?? []).map((i) => [i.party_id, i.phone as string | null]));
  const partyByAnalyst = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));
  const partyByIntroducer = new Map((introducers ?? []).map((i) => [i.id, i.party_id]));
  const partyByCustomer = new Map((customers ?? []).map((c) => [c.id, c.party_id]));
  const phoneByCustomer = new Map(
    [...partyByCustomer.entries()].map(([customerId, partyId]) => [customerId, phoneByParty.get(partyId) ?? null])
  );

  // Earliest approved/paid introducer commission date per phone number,
  // across every customer_id sharing that phone — this is the same "is this
  // person's phone already on record" signal the SQL guard checks.
  const earliestByPhone = new Map<string, { date: string; customerId: string }>();
  for (const r of priorIntroRecords ?? []) {
    const phone = phoneByCustomer.get(r.customer_id as string);
    if (!phone) continue;
    const existing = earliestByPhone.get(phone);
    if (!existing || r.calculated_at < existing.date) {
      earliestByPhone.set(phone, { date: r.calculated_at, customerId: r.customer_id as string });
    }
  }

  return records.map((r) => {
    const isIntroducer = !!r.introducer_id;
    const partyId = isIntroducer ? partyByIntroducer.get(r.introducer_id as string) : partyByAnalyst.get(r.analyst_id as string);

    let customerName: string | null = null;
    let customerPhoneMasked: string | null = null;
    let priorSettlementDate: string | null = null;
    if (r.trigger_type === "introducer" && r.customer_id) {
      const customerParty = partyByCustomer.get(r.customer_id);
      customerName = (customerParty && nameByParty.get(customerParty)) ?? null;
      const phone = phoneByCustomer.get(r.customer_id) ?? null;
      customerPhoneMasked = phone ? maskPhone(phone) : null;
      const earliest = phone ? earliestByPhone.get(phone) : undefined;
      // Only a hint if the earliest record belongs to a DIFFERENT customer_id
      // than this row's own — a customer's own first (and only) settlement
      // isn't "prior history", it's just itself.
      if (earliest && earliest.customerId !== r.customer_id) {
        priorSettlementDate = earliest.date;
      }
    }

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
      analyst_id: r.analyst_id,
      introducer_id: r.introducer_id,
      customer_name: customerName,
      customer_phone_masked: customerPhoneMasked,
      prior_settlement_date: priorSettlementDate,
    };
  });
}
