import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export interface ReportableOrder {
  order_id: string;
  item_id: string;
  customer_name: string;
  analyst_name: string;
  item_type: string;
  amount: number;
  created_at: string;
  report_delivered_at: string | null;
  can_mark_delivered: boolean; // true only for whoever submitted the order, or back office
}

// One row per person (order_item), not per order — a multi-person order
// (e.g. a family visiting together) can credit different agents to
// different items, so "my reports" means "items assigned to me", not
// "orders I submitted". report_delivered_at is still order-level (one flag
// for the whole order/payment), so every item on the same order shares the
// same delivered status; only the submitting agent (orders.analyst_id) or
// back office can mark it, even though other agents can see their own item.
export async function listReportableOrders(isBackOffice: boolean, selfAnalystId: string | null): Promise<ReportableOrder[]> {
  const admin = createAdminClient();

  const { data: orders } = await admin
    .from("orders")
    .select("id, analyst_id, created_at, report_delivered_at")
    .eq("order_type", "detection_service")
    .eq("status", "paid")
    .order("created_at", { ascending: false });
  if (!orders || orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const { data: items } = await admin
    .from("order_items")
    .select("id, order_id, item_type, subtotal, customer_id, analyst_id")
    .in("order_id", orderIds);
  if (!items || items.length === 0) return [];

  const scopedItems = isBackOffice ? items : items.filter((it) => it.analyst_id === selfAnalystId);
  if (scopedItems.length === 0) return [];

  const orderById = new Map(orders.map((o) => [o.id, o]));
  const customerIds = [...new Set(scopedItems.map((it) => it.customer_id).filter((id): id is string => !!id))];
  const analystIds = [...new Set(scopedItems.map((it) => it.analyst_id).filter((id): id is string => !!id))];

  const [{ data: customers }, { data: analysts }] = await Promise.all([
    customerIds.length > 0 ? admin.from("customers").select("id, party_id").in("id", customerIds) : Promise.resolve({ data: [] }),
    analystIds.length > 0 ? admin.from("analysts").select("id, party_id").in("id", analystIds) : Promise.resolve({ data: [] }),
  ]);
  const customerPartyById = new Map((customers ?? []).map((c) => [c.id, c.party_id]));
  const analystPartyById = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));
  const partyIds = [...new Set([...customerPartyById.values(), ...analystPartyById.values()])];
  const { data: identities } = await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds);
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));

  return scopedItems
    .map((it) => {
      const order = orderById.get(it.order_id);
      if (!order) return null;
      const customerParty = it.customer_id ? customerPartyById.get(it.customer_id) : null;
      const analystParty = it.analyst_id ? analystPartyById.get(it.analyst_id) : null;
      return {
        order_id: order.id,
        item_id: it.id,
        customer_name: (customerParty && nameByParty.get(customerParty)) ?? "—",
        analyst_name: (analystParty && nameByParty.get(analystParty)) ?? "—",
        item_type: it.item_type,
        amount: Number(it.subtotal),
        created_at: order.created_at,
        report_delivered_at: order.report_delivered_at,
        can_mark_delivered: isBackOffice || order.analyst_id === selfAnalystId,
      };
    })
    .filter((row): row is ReportableOrder => row !== null)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
