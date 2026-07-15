import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getSignedDocumentUrl } from "@/lib/storage";

export interface SalesOrderRow {
  order_id: string;
  customer_name: string; // single name, or "N 位顾客" when the order covers several people
  analyst_name: string; // whoever submitted the order (orders.analyst_id) — not necessarily who's credited on every item
  item_type: string;
  total_amount: number;
  order_status: string;
  review_status: string | null; // null when there's no sales_orders row (voucher redemption — nothing to review)
  created_at: string;
}

// Self-scope callers read orders through their own RLS session — this now
// includes orders the caller didn't submit but has an assigned item on (see
// migration 012's "analyst reads orders containing their assigned items"
// policy), since a multi-person order can credit a different agent per item.
// The merge lookups use the admin client but only ever key off ids the
// caller's own orders already reference.
export async function listSalesOrders(isBackOffice: boolean, statusFilter?: string): Promise<SalesOrderRow[]> {
  const selfClient = await createServerSupabaseClient();
  const client = isBackOffice ? createAdminClient() : selfClient;

  let query = client
    .from("orders")
    .select("id, analyst_id, total_amount, status, created_at")
    .eq("order_type", "detection_service")
    .order("created_at", { ascending: false });
  const { data: orders } = await query;
  if (!orders || orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const analystIds = [...new Set(orders.map((o) => o.analyst_id).filter((id): id is string => !!id))];

  const admin = createAdminClient();
  const [{ data: analysts }, { data: items }, { data: salesOrders }] = await Promise.all([
    analystIds.length > 0 ? admin.from("analysts").select("id, party_id").in("id", analystIds) : Promise.resolve({ data: [] }),
    admin.from("order_items").select("order_id, item_type, customer_id").in("order_id", orderIds),
    admin.from("sales_orders").select("order_id, status").in("order_id", orderIds),
  ]);

  const itemsByOrder = new Map<string, { item_type: string; customer_id: string | null }[]>();
  for (const it of items ?? []) {
    const arr = itemsByOrder.get(it.order_id) ?? [];
    arr.push({ item_type: it.item_type, customer_id: it.customer_id });
    itemsByOrder.set(it.order_id, arr);
  }
  const customerIds = [...new Set((items ?? []).map((i) => i.customer_id).filter((id): id is string => !!id))];

  const analystPartyById = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));
  const { data: customers } = customerIds.length > 0 ? await admin.from("customers").select("id, party_id").in("id", customerIds) : { data: [] };
  const customerPartyById = new Map((customers ?? []).map((c) => [c.id, c.party_id]));
  const partyIds = [...new Set([...analystPartyById.values(), ...customerPartyById.values()])];
  const { data: identities } = await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds);
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));

  const reviewStatusByOrder = new Map((salesOrders ?? []).map((s) => [s.order_id, s.status]));

  let rows = orders.map((o) => {
    const orderItems = itemsByOrder.get(o.id) ?? [];
    const itemCustomerIds = [...new Set(orderItems.map((it) => it.customer_id).filter((id): id is string => !!id))];
    let customerName = "—";
    if (itemCustomerIds.length === 1) {
      const party = customerPartyById.get(itemCustomerIds[0]);
      customerName = (party && nameByParty.get(party)) ?? "—";
    } else if (itemCustomerIds.length > 1) {
      customerName = `${itemCustomerIds.length} 位顾客`;
    }
    const analystParty = o.analyst_id ? analystPartyById.get(o.analyst_id) : null;
    return {
      order_id: o.id,
      customer_name: customerName,
      analyst_name: (analystParty && nameByParty.get(analystParty)) ?? "—",
      item_type: orderItems[0]?.item_type ?? "—",
      total_amount: Number(o.total_amount),
      order_status: o.status,
      review_status: reviewStatusByOrder.get(o.id) ?? null,
      created_at: o.created_at,
    };
  });

  if (statusFilter === "pending") {
    rows = rows.filter((r) => r.review_status === "pending");
  }

  return rows;
}

export interface SalesOrderDetailItem {
  item_id: string;
  customer_name: string;
  analyst_name: string;
  subtotal: number;
}

export interface SalesOrderDetail {
  order_id: string;
  analyst_name: string; // who submitted the order
  total_amount: number;
  order_status: string;
  sales_order_id: string;
  review_status: string;
  payment_screenshot_signed_url: string | null;
  rejection_reason: string | null;
  created_at: string;
  items: SalesOrderDetailItem[];
}

export async function getSalesOrderDetail(orderId: string): Promise<SalesOrderDetail | null> {
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, analyst_id, total_amount, status, created_at")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return null;

  const { data: salesOrder } = await admin
    .from("sales_orders")
    .select("id, status, payment_screenshot_url, rejection_reason")
    .eq("order_id", orderId)
    .maybeSingle();
  if (!salesOrder) return null; // voucher-redemption orders have nothing to review

  const { data: items } = await admin.from("order_items").select("id, customer_id, analyst_id, subtotal").eq("order_id", orderId);

  const itemCustomerIds = [...new Set((items ?? []).map((i) => i.customer_id).filter((id): id is string => !!id))];
  const itemAnalystIds = [...new Set((items ?? []).map((i) => i.analyst_id).filter((id): id is string => !!id))];
  const analystIds = [...new Set([order.analyst_id, ...itemAnalystIds].filter((id): id is string => !!id))];

  const [{ data: customers }, { data: analysts }] = await Promise.all([
    itemCustomerIds.length > 0 ? admin.from("customers").select("id, party_id").in("id", itemCustomerIds) : Promise.resolve({ data: [] }),
    analystIds.length > 0 ? admin.from("analysts").select("id, party_id").in("id", analystIds) : Promise.resolve({ data: [] }),
  ]);
  const customerPartyById = new Map((customers ?? []).map((c) => [c.id, c.party_id]));
  const analystPartyById = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));
  const partyIds = [...new Set([...customerPartyById.values(), ...analystPartyById.values()])];
  const { data: identities } = await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds.length > 0 ? partyIds : ["00000000-0000-0000-0000-000000000000"]);
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));

  const screenshotUrl = await getSignedDocumentUrl("payment-screenshots", salesOrder.payment_screenshot_url);
  const orderAnalystParty = order.analyst_id ? analystPartyById.get(order.analyst_id) : null;

  return {
    order_id: order.id,
    analyst_name: (orderAnalystParty && nameByParty.get(orderAnalystParty)) ?? "—",
    total_amount: Number(order.total_amount),
    order_status: order.status,
    sales_order_id: salesOrder.id,
    review_status: salesOrder.status,
    payment_screenshot_signed_url: screenshotUrl,
    rejection_reason: salesOrder.rejection_reason,
    created_at: order.created_at,
    items: (items ?? []).map((it) => {
      const customerParty = it.customer_id ? customerPartyById.get(it.customer_id) : null;
      const itemAnalystParty = it.analyst_id ? analystPartyById.get(it.analyst_id) : null;
      return {
        item_id: it.id,
        customer_name: (customerParty && nameByParty.get(customerParty)) ?? "—",
        analyst_name: (itemAnalystParty && nameByParty.get(itemAnalystParty)) ?? "—",
        subtotal: Number(it.subtotal),
      };
    }),
  };
}

export interface ReceiptLineItem {
  description: string;
  customer_name: string | null;
  subtotal: number;
}

export interface ReceiptDetail {
  order_id: string;
  order_analyst_id: string | null;
  item_analyst_ids: string[];
  analyst_name: string;
  customer_name: string; // single name, or "N 位顾客" for a multi-person order
  total_amount: number;
  status: string;
  created_at: string;
  items: ReceiptLineItem[];
}

// Printable receipt for a regular (non-institutional) detection_service
// order — analysts couldn't get one anywhere before this; the only
// printable document in the whole system was the institutional (B2B)
// invoice/receipt, which is back-office/finance only.
export async function getReceiptDetail(orderId: string): Promise<ReceiptDetail | null> {
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, analyst_id, total_amount, status, created_at, order_type")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.order_type !== "detection_service") return null;

  const { data: items } = await admin.from("order_items").select("id, description, customer_id, analyst_id, subtotal").eq("order_id", orderId);

  const itemCustomerIds = [...new Set((items ?? []).map((i) => i.customer_id).filter((id): id is string => !!id))];
  const itemAnalystIds = [...new Set((items ?? []).map((i) => i.analyst_id).filter((id): id is string => !!id))];
  const analystIds = [...new Set([order.analyst_id, ...itemAnalystIds].filter((id): id is string => !!id))];

  const [{ data: customers }, { data: analysts }] = await Promise.all([
    itemCustomerIds.length > 0 ? admin.from("customers").select("id, party_id").in("id", itemCustomerIds) : Promise.resolve({ data: [] }),
    analystIds.length > 0 ? admin.from("analysts").select("id, party_id").in("id", analystIds) : Promise.resolve({ data: [] }),
  ]);
  const customerPartyById = new Map((customers ?? []).map((c) => [c.id, c.party_id]));
  const analystPartyById = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));
  const partyIds = [...new Set([...customerPartyById.values(), ...analystPartyById.values()])];
  const { data: identities } =
    partyIds.length > 0 ? await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds) : { data: [] };
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));

  const orderAnalystParty = order.analyst_id ? analystPartyById.get(order.analyst_id) : null;

  let customerName = "—";
  if (itemCustomerIds.length === 1) {
    const party = customerPartyById.get(itemCustomerIds[0]);
    customerName = (party && nameByParty.get(party)) ?? "—";
  } else if (itemCustomerIds.length > 1) {
    customerName = `${itemCustomerIds.length} 位顾客`;
  }

  return {
    order_id: order.id,
    order_analyst_id: order.analyst_id,
    item_analyst_ids: itemAnalystIds,
    analyst_name: (orderAnalystParty && nameByParty.get(orderAnalystParty)) ?? "—",
    customer_name: customerName,
    total_amount: Number(order.total_amount),
    status: order.status,
    created_at: order.created_at,
    items: (items ?? []).map((it) => {
      const party = it.customer_id ? customerPartyById.get(it.customer_id) : null;
      return {
        description: it.description ?? "—",
        customer_name: party ? (nameByParty.get(party) ?? null) : null,
        subtotal: Number(it.subtotal),
      };
    }),
  };
}

export async function listOwnCustomersForPicker(analystId: string): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  const { data: customers } = await admin.from("customers").select("id, party_id").eq("owner_analyst_id", analystId).eq("status", "active");
  if (!customers || customers.length === 0) return [];
  const { data: identities } = await admin.from("individuals").select("party_id, full_name").in("party_id", customers.map((c) => c.party_id));
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));
  return customers.map((c) => ({ id: c.id, name: nameByParty.get(c.party_id) ?? "—" }));
}

// For the per-item "assigned agent" picker on the new-order form — a
// multi-person order can credit different agents to different family
// members, not just the agent submitting the order.
export async function listApprovedAgents(): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  const { data: analysts } = await admin.from("analysts").select("id, party_id").eq("status", "approved");
  if (!analysts || analysts.length === 0) return [];
  const { data: identities } = await admin.from("individuals").select("party_id, full_name").in("party_id", analysts.map((a) => a.party_id));
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));
  return analysts.map((a) => ({ id: a.id, name: nameByParty.get(a.party_id) ?? "—" }));
}

export async function listOwnRedeemableVouchers(analystId: string): Promise<{ id: string; label: string }[]> {
  const admin = createAdminClient();
  const { data: vouchers } = await admin
    .from("detection_vouchers")
    .select("id, issued_at")
    .eq("analyst_id", analystId)
    .eq("voucher_type", "resale")
    .eq("status", "issued")
    .order("issued_at", { ascending: true });
  return (vouchers ?? []).map((v) => ({ id: v.id, label: `检测券 · ${new Date(v.issued_at).toLocaleDateString("zh-CN")} 发放` }));
}
