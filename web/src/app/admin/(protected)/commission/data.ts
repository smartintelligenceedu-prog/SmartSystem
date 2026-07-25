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
  // Who actually generated this commission — the newly-recruited analyst for
  // 'recruitment' rows, or the performing analyst on the underlying
  // order_item for 'personal_sale' / 'report_override' / 'analyst_report_fee'
  // / 'voucher_resale' rows. Distinct from payee_name: e.g. a report_override
  // row is PAID to the leader but SOURCED FROM their downline's delivered
  // report — this is what answers "which agent did this actually come from".
  // Null when the source is the same person as the payee (nothing useful to
  // add) or for trigger_type = 'introducer' (customer_name already covers it).
  source_name: string | null;
}

const RECENT_LIMIT = 200;

export interface CommissionSourceInput {
  id: string;
  trigger_type: string;
  source_transaction_type: string;
  source_transaction_id: string;
}

export interface CommissionSource {
  name: string | null;
  analystId: string | null;
  customerName: string | null;
}

// Shared source-resolution used by both the back-office list (listAllCommissions
// below) and the self-view (an analyst checking their own commission page) —
// "who actually generated this" as opposed to "who gets paid". Uses the admin
// client since resolving another analyst's name (e.g. a leader's downline) is
// outside what a plain analyst session's RLS would allow to read directly,
// even though seeing it here is fine — it's already implied by the org
// structure a leader can see on their own Team page.
export async function resolveCommissionSourceNames(records: CommissionSourceInput[]): Promise<Map<string, CommissionSource>> {
  const admin = createAdminClient();

  const orderItemSourceIds = [
    ...new Set(records.filter((r) => r.source_transaction_type === "order_item").map((r) => r.source_transaction_id)),
  ];
  const recruitmentOrderIds = [
    ...new Set(records.filter((r) => r.trigger_type === "recruitment" && r.source_transaction_type === "order").map((r) => r.source_transaction_id)),
  ];
  const [{ data: sourceItems }, { data: sourceRegOrders }] = await Promise.all([
    orderItemSourceIds.length > 0
      ? admin.from("order_items").select("id, analyst_id, customer_id").in("id", orderItemSourceIds)
      : Promise.resolve({ data: [] }),
    recruitmentOrderIds.length > 0
      ? admin.from("registration_orders").select("order_id, party_id").in("order_id", recruitmentOrderIds)
      : Promise.resolve({ data: [] }),
  ]);
  const sourceAnalystByItemId = new Map((sourceItems ?? []).filter((i) => i.analyst_id).map((i) => [i.id, i.analyst_id as string]));
  const itemCustomerByItemId = new Map((sourceItems ?? []).filter((i) => i.customer_id).map((i) => [i.id, i.customer_id as string]));
  const sourcePartyByOrderId = new Map((sourceRegOrders ?? []).map((o) => [o.order_id, o.party_id as string]));
  const sourceAnalystIds = [...new Set(sourceAnalystByItemId.values())];

  const { data: analysts } =
    sourceAnalystIds.length > 0 ? await admin.from("analysts").select("id, party_id").in("id", sourceAnalystIds) : { data: [] };
  const partyByAnalyst = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));

  const customerIds = [...new Set(itemCustomerByItemId.values())];
  const { data: customers } =
    customerIds.length > 0 ? await admin.from("customers").select("id, party_id").in("id", customerIds) : { data: [] };
  const partyByCustomer = new Map((customers ?? []).map((c) => [c.id, c.party_id]));

  const partyIds = [...new Set([...partyByAnalyst.values(), ...sourcePartyByOrderId.values(), ...partyByCustomer.values()])];
  const { data: identities } =
    partyIds.length > 0 ? await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds) : { data: [] };
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));

  const result = new Map<string, CommissionSource>();
  for (const r of records) {
    let name: string | null = null;
    let analystId: string | null = null;
    if (r.trigger_type === "recruitment" && r.source_transaction_type === "order") {
      const sourceParty = sourcePartyByOrderId.get(r.source_transaction_id);
      name = (sourceParty && nameByParty.get(sourceParty)) ?? null;
    } else if (r.source_transaction_type === "order_item") {
      analystId = sourceAnalystByItemId.get(r.source_transaction_id) ?? null;
      const sourceParty = analystId ? partyByAnalyst.get(analystId) : null;
      name = (sourceParty && nameByParty.get(sourceParty)) ?? null;
    }

    let customerName: string | null = null;
    const customerId = itemCustomerByItemId.get(r.source_transaction_id);
    if (customerId) {
      const customerParty = partyByCustomer.get(customerId);
      customerName = (customerParty && nameByParty.get(customerParty)) ?? null;
    }

    if (name || customerName) result.set(r.id, { name, analystId, customerName });
  }
  return result;
}

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
//
// dateFrom/dateTo ("YYYY-MM-DD", both optional, inclusive) let back office
// look at a specific past period instead of only ever seeing the most
// recent RECENT_LIMIT rows — the cap only applies when NO date filter is
// given, since a deliberately date-scoped query should return everything in
// range, not silently truncate.
export async function listAllCommissions(dateFrom?: string, dateTo?: string): Promise<CommissionRow[]> {
  const admin = createAdminClient();

  let query = admin
    .from("commission_records")
    .select(
      "id, trigger_type, calculation_type, rate_applied, base_amount, commission_amount, original_amount, status, calculated_at, adjusted_at, adjustment_reason, analyst_id, introducer_id, customer_id, source_transaction_type, source_transaction_id"
    )
    .order("calculated_at", { ascending: false });
  if (dateFrom) query = query.gte("calculated_at", `${dateFrom}T00:00:00+08:00`);
  if (dateTo) {
    const exclusiveEnd = new Date(`${dateTo}T00:00:00+08:00`);
    exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
    query = query.lt("calculated_at", exclusiveEnd.toISOString());
  }
  if (!dateFrom && !dateTo) query = query.limit(RECENT_LIMIT);

  const { data: records } = await query;
  if (!records || records.length === 0) return [];

  // Source resolution — who actually generated the commission, as opposed to
  // who gets paid. order_item-sourced trigger types (personal_sale,
  // report_override, analyst_report_fee, voucher_resale) look up that item's
  // own analyst_id; recruitment (order-sourced) looks up the registration's
  // party via registration_orders. introducer rows already carry customer_id
  // for this purpose and are skipped here.
  const orderItemSourceIds = [
    ...new Set(records.filter((r) => r.source_transaction_type === "order_item").map((r) => r.source_transaction_id)),
  ];
  const recruitmentOrderIds = [
    ...new Set(records.filter((r) => r.trigger_type === "recruitment" && r.source_transaction_type === "order").map((r) => r.source_transaction_id)),
  ];
  const [{ data: sourceItems }, { data: sourceRegOrders }] = await Promise.all([
    orderItemSourceIds.length > 0
      ? admin.from("order_items").select("id, analyst_id, customer_id").in("id", orderItemSourceIds)
      : Promise.resolve({ data: [] }),
    recruitmentOrderIds.length > 0
      ? admin.from("registration_orders").select("order_id, party_id").in("order_id", recruitmentOrderIds)
      : Promise.resolve({ data: [] }),
  ]);
  const sourceAnalystByItemId = new Map((sourceItems ?? []).filter((i) => i.analyst_id).map((i) => [i.id, i.analyst_id as string]));
  // The customer whose order this commission came from — populated for every
  // order_item-sourced row (not just 'introducer'), so e.g. an
  // analyst_report_fee row (always self-sourced, no useful "different
  // agent" to show) can still show which customer's report earned it.
  const itemCustomerByItemId = new Map((sourceItems ?? []).filter((i) => i.customer_id).map((i) => [i.id, i.customer_id as string]));
  const sourcePartyByOrderId = new Map((sourceRegOrders ?? []).map((o) => [o.order_id, o.party_id as string]));

  const sourceAnalystIds = [...new Set([...sourceAnalystByItemId.values()])];

  const analystIds = [
    ...new Set([...records.filter((r) => r.analyst_id).map((r) => r.analyst_id as string), ...sourceAnalystIds]),
  ];
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
  const allCustomerIds = [
    ...new Set([...visibleCustomerIds, ...priorCustomerIds, ...itemCustomerByItemId.values()]),
  ];

  const [{ data: analysts }, { data: introducers }, { data: customers }] = await Promise.all([
    analystIds.length > 0 ? admin.from("analysts").select("id, party_id").in("id", analystIds) : Promise.resolve({ data: [] }),
    introducerIds.length > 0
      ? admin.from("introducers").select("id, party_id").in("id", introducerIds)
      : Promise.resolve({ data: [] }),
    allCustomerIds.length > 0 ? admin.from("customers").select("id, party_id").in("id", allCustomerIds) : Promise.resolve({ data: [] }),
  ]);

  const partyIds = [
    ...new Set([
      ...(analysts ?? []).map((a) => a.party_id),
      ...(introducers ?? []).map((i) => i.party_id),
      ...(customers ?? []).map((c) => c.party_id),
      ...sourcePartyByOrderId.values(),
    ]),
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
    const customerIdForRow = r.trigger_type === "introducer" ? r.customer_id : itemCustomerByItemId.get(r.source_transaction_id);
    if (customerIdForRow) {
      const customerParty = partyByCustomer.get(customerIdForRow);
      customerName = (customerParty && nameByParty.get(customerParty)) ?? null;
      const phone = phoneByCustomer.get(customerIdForRow) ?? null;
      customerPhoneMasked = phone ? maskPhone(phone) : null;
      if (r.trigger_type === "introducer") {
        // Only a hint if the earliest record belongs to a DIFFERENT
        // customer_id than this row's own — a customer's own first (and
        // only) settlement isn't "prior history", it's just itself.
        const earliest = phone ? earliestByPhone.get(phone) : undefined;
        if (earliest && earliest.customerId !== customerIdForRow) {
          priorSettlementDate = earliest.date;
        }
      }
    }

    let sourceName: string | null = null;
    let sourceAnalystId: string | null = null;
    if (r.trigger_type === "recruitment" && r.source_transaction_type === "order") {
      const sourceParty = sourcePartyByOrderId.get(r.source_transaction_id);
      sourceName = (sourceParty && nameByParty.get(sourceParty)) ?? null;
    } else if (r.source_transaction_type === "order_item") {
      sourceAnalystId = sourceAnalystByItemId.get(r.source_transaction_id) ?? null;
      const sourceParty = sourceAnalystId ? partyByAnalyst.get(sourceAnalystId) : null;
      sourceName = (sourceParty && nameByParty.get(sourceParty)) ?? null;
    }
    // Nothing useful to add when the source is the same analyst as the payee
    // (e.g. analyst_report_fee, which is always paid to whoever performed
    // the work — "sourced from yourself" isn't a meaningful distinction).
    // Compared by id, not name, so two different people who happen to share
    // a name are never conflated.
    if (!isIntroducer && sourceAnalystId && sourceAnalystId === r.analyst_id) sourceName = null;
    const payeeNameForCompare = (partyId && nameByParty.get(partyId)) ?? "—";

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
      payee_name: payeeNameForCompare,
      source_name: sourceName,
      analyst_id: r.analyst_id,
      introducer_id: r.introducer_id,
      customer_name: customerName,
      customer_phone_masked: customerPhoneMasked,
      prior_settlement_date: priorSettlementDate,
    };
  });
}
