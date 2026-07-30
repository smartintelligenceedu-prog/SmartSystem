import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { listAllCommissions } from "../data";

export interface PersonCommissionBreakdown {
  trigger_type: string;
  amount: number;
  count: number;
}

export interface AnalystSummaryRow {
  analyst_id: string;
  name: string;
  total_sales: number;
  total_commission: number;
  breakdown: PersonCommissionBreakdown[];
}

export interface IntroducerSummaryRow {
  introducer_id: string;
  name: string;
  total_sales: number;
  total_commission: number;
  breakdown: PersonCommissionBreakdown[];
}

// "YYYY-MM-DD" (inclusive on both ends) -> exclusive-end ISO timestamp,
// matching listAllCommissions()'s own dateTo handling in ../data.ts.
function exclusiveEndISO(dateTo: string): string {
  const d = new Date(`${dateTo}T00:00:00+08:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function addToBreakdown(byType: Map<string, PersonCommissionBreakdown>, triggerType: string, amount: number) {
  const existing = byType.get(triggerType) ?? { trigger_type: triggerType, amount: 0, count: 0 };
  existing.amount += amount;
  existing.count += 1;
  byType.set(triggerType, existing);
}

// Paid order_items in the window whose item_type actually represents a real
// service sale (registration_kit/'other' excluded — those never drive
// personal_sale/analyst_report_fee/introducer commission either). Flat query
// + JS merge, same pattern as listAllCommissions() above: fetch orders in
// range first, then order_items by order_id, rather than relying on
// PostgREST embedded-table filters.
async function listPaidSaleItemsInRange(dateFrom: string, dateTo: string) {
  const admin = createAdminClient();
  const { data: paidOrders } = await admin
    .from("orders")
    .select("id")
    .eq("status", "paid")
    .gte("created_at", `${dateFrom}T00:00:00+08:00`)
    .lt("created_at", exclusiveEndISO(dateTo));
  const paidOrderIds = (paidOrders ?? []).map((o) => o.id as string);
  if (paidOrderIds.length === 0) return [];
  const { data: items } = await admin
    .from("order_items")
    .select("analyst_id, customer_id, subtotal")
    .in("order_id", paidOrderIds)
    .in("item_type", ["detection_session", "voucher_redemption"]);
  return items ?? [];
}

// "本月销售额" per analyst = sum of order_items.subtotal on paid orders in
// range where that analyst is the assigned agent on the line item — the
// exact same items that drive their personal_sale / analyst_report_fee
// commission, so the two figures describe the same underlying business.
// "本月佣金" = every commission_records row paid TO that analyst in range,
// regardless of trigger_type (includes recruitment/report_override earned
// from other people's sales) — broken down by trigger_type for drill-down.
export async function listAnalystMonthlySummary(dateFrom: string, dateTo: string): Promise<AnalystSummaryRow[]> {
  const admin = createAdminClient();
  const [commissionRows, saleItems] = await Promise.all([
    listAllCommissions(dateFrom, dateTo),
    listPaidSaleItemsInRange(dateFrom, dateTo),
  ]);

  const nameByAnalyst = new Map<string, string>();
  const breakdownByAnalyst = new Map<string, Map<string, PersonCommissionBreakdown>>();
  for (const r of commissionRows) {
    if (r.payee_type !== "analyst" || !r.analyst_id) continue;
    nameByAnalyst.set(r.analyst_id, r.payee_name);
    let byType = breakdownByAnalyst.get(r.analyst_id);
    if (!byType) {
      byType = new Map();
      breakdownByAnalyst.set(r.analyst_id, byType);
    }
    addToBreakdown(byType, r.trigger_type, r.commission_amount);
  }

  const salesByAnalyst = new Map<string, number>();
  for (const item of saleItems) {
    if (!item.analyst_id) continue;
    const id = item.analyst_id as string;
    salesByAnalyst.set(id, (salesByAnalyst.get(id) ?? 0) + Number(item.subtotal));
  }

  const allAnalystIds = new Set<string>([...nameByAnalyst.keys(), ...salesByAnalyst.keys()]);
  const missingNameIds = [...allAnalystIds].filter((id) => !nameByAnalyst.has(id));
  if (missingNameIds.length > 0) {
    const { data: analysts } = await admin.from("analysts").select("id, party_id").in("id", missingNameIds);
    const partyIds = (analysts ?? []).map((a) => a.party_id as string);
    const { data: identities } =
      partyIds.length > 0 ? await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds) : { data: [] };
    const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name as string]));
    for (const a of analysts ?? []) {
      nameByAnalyst.set(a.id as string, nameByParty.get(a.party_id as string) ?? "—");
    }
  }

  const rows: AnalystSummaryRow[] = [...allAnalystIds].map((id) => {
    const breakdown = [...(breakdownByAnalyst.get(id)?.values() ?? [])].sort((a, b) => b.amount - a.amount);
    return {
      analyst_id: id,
      name: nameByAnalyst.get(id) ?? "—",
      total_sales: salesByAnalyst.get(id) ?? 0,
      total_commission: breakdown.reduce((sum, b) => sum + b.amount, 0),
      breakdown,
    };
  });
  rows.sort((a, b) => b.total_commission - a.total_commission);
  return rows;
}

// Same shape for introducers — "销售额" here means the total value of paid
// orders belonging to customers THIS introducer referred (customers.
// acquired_via_introducer_id), not anything the introducer sold themselves
// (introducers don't process orders). "佣金" is every commission_records row
// paid to them, almost always trigger_type='introducer' but broken down the
// same way for consistency (and in case a future rule type ever pays them
// through another trigger).
export async function listIntroducerMonthlySummary(dateFrom: string, dateTo: string): Promise<IntroducerSummaryRow[]> {
  const admin = createAdminClient();
  const [commissionRows, saleItems] = await Promise.all([
    listAllCommissions(dateFrom, dateTo),
    listPaidSaleItemsInRange(dateFrom, dateTo),
  ]);

  const nameByIntroducer = new Map<string, string>();
  const breakdownByIntroducer = new Map<string, Map<string, PersonCommissionBreakdown>>();
  for (const r of commissionRows) {
    if (r.payee_type !== "introducer" || !r.introducer_id) continue;
    nameByIntroducer.set(r.introducer_id, r.payee_name);
    let byType = breakdownByIntroducer.get(r.introducer_id);
    if (!byType) {
      byType = new Map();
      breakdownByIntroducer.set(r.introducer_id, byType);
    }
    addToBreakdown(byType, r.trigger_type, r.commission_amount);
  }

  const customerIds = [...new Set(saleItems.filter((i) => i.customer_id).map((i) => i.customer_id as string))];
  const { data: customers } =
    customerIds.length > 0 ? await admin.from("customers").select("id, acquired_via_introducer_id").in("id", customerIds) : { data: [] };
  const introducerByCustomer = new Map(
    (customers ?? []).filter((c) => c.acquired_via_introducer_id).map((c) => [c.id as string, c.acquired_via_introducer_id as string])
  );

  const salesByIntroducer = new Map<string, number>();
  for (const item of saleItems) {
    if (!item.customer_id) continue;
    const introducerId = introducerByCustomer.get(item.customer_id as string);
    if (!introducerId) continue;
    salesByIntroducer.set(introducerId, (salesByIntroducer.get(introducerId) ?? 0) + Number(item.subtotal));
  }

  const allIntroducerIds = new Set<string>([...nameByIntroducer.keys(), ...salesByIntroducer.keys()]);
  const missingNameIds = [...allIntroducerIds].filter((id) => !nameByIntroducer.has(id));
  if (missingNameIds.length > 0) {
    const { data: introducers } = await admin.from("introducers").select("id, party_id").in("id", missingNameIds);
    const partyIds = (introducers ?? []).map((i) => i.party_id as string);
    const { data: identities } =
      partyIds.length > 0 ? await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds) : { data: [] };
    const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name as string]));
    for (const i of introducers ?? []) {
      nameByIntroducer.set(i.id as string, nameByParty.get(i.party_id as string) ?? "—");
    }
  }

  const rows: IntroducerSummaryRow[] = [...allIntroducerIds].map((id) => {
    const breakdown = [...(breakdownByIntroducer.get(id)?.values() ?? [])].sort((a, b) => b.amount - a.amount);
    return {
      introducer_id: id,
      name: nameByIntroducer.get(id) ?? "—",
      total_sales: salesByIntroducer.get(id) ?? 0,
      total_commission: breakdown.reduce((sum, b) => sum + b.amount, 0),
      breakdown,
    };
  });
  rows.sort((a, b) => b.total_commission - a.total_commission);
  return rows;
}
