import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export interface ReportableOrder {
  order_id: string;
  customer_name: string;
  analyst_name: string;
  item_type: string;
  total_amount: number;
  created_at: string;
  report_delivered_at: string | null;
}

// Only paid detection_service orders represent an actual detection that
// happened — registration orders have no report to deliver. Self-scope
// callers read through their own RLS session; the merge lookups use the
// admin client but only ever key off ids the caller's own orders already
// reference, same pattern as sales-orders/data.ts.
export async function listReportableOrders(isBackOffice: boolean): Promise<ReportableOrder[]> {
  const selfClient = await createServerSupabaseClient();
  const client = isBackOffice ? createAdminClient() : selfClient;

  const { data: orders } = await client
    .from("orders")
    .select("id, customer_id, analyst_id, total_amount, created_at, report_delivered_at")
    .eq("order_type", "detection_service")
    .eq("status", "paid")
    .order("created_at", { ascending: false });
  if (!orders || orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const customerIds = [...new Set(orders.map((o) => o.customer_id).filter((id): id is string => !!id))];
  const analystIds = [...new Set(orders.map((o) => o.analyst_id).filter((id): id is string => !!id))];

  const admin = createAdminClient();
  const [{ data: customers }, { data: analysts }, { data: items }] = await Promise.all([
    customerIds.length > 0 ? admin.from("customers").select("id, party_id").in("id", customerIds) : Promise.resolve({ data: [] }),
    analystIds.length > 0 ? admin.from("analysts").select("id, party_id").in("id", analystIds) : Promise.resolve({ data: [] }),
    admin.from("order_items").select("order_id, item_type").in("order_id", orderIds),
  ]);

  const customerPartyById = new Map((customers ?? []).map((c) => [c.id, c.party_id]));
  const analystPartyById = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));
  const partyIds = [...new Set([...customerPartyById.values(), ...analystPartyById.values()])];
  const { data: identities } = await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds);
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));
  const itemTypeByOrder = new Map((items ?? []).map((i) => [i.order_id, i.item_type]));

  return orders.map((o) => {
    const customerParty = o.customer_id ? customerPartyById.get(o.customer_id) : null;
    const analystParty = o.analyst_id ? analystPartyById.get(o.analyst_id) : null;
    return {
      order_id: o.id,
      customer_name: (customerParty && nameByParty.get(customerParty)) ?? "—",
      analyst_name: (analystParty && nameByParty.get(analystParty)) ?? "—",
      item_type: itemTypeByOrder.get(o.id) ?? "—",
      total_amount: Number(o.total_amount),
      created_at: o.created_at,
      report_delivered_at: o.report_delivered_at,
    };
  });
}
