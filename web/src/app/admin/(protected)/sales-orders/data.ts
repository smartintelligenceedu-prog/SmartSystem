import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getSignedDocumentUrl } from "@/lib/storage";

export interface SalesOrderRow {
  order_id: string;
  customer_name: string;
  analyst_name: string;
  item_type: string;
  total_amount: number;
  order_status: string;
  review_status: string | null; // null when there's no sales_orders row (voucher redemption — nothing to review)
  created_at: string;
}

// Self-scope callers read orders through their own RLS session (analyst_id =
// current_analyst_id() or back office); the merge lookups use the admin
// client but only ever key off ids the caller's own orders already reference.
export async function listSalesOrders(isBackOffice: boolean, statusFilter?: string): Promise<SalesOrderRow[]> {
  const selfClient = await createServerSupabaseClient();
  const client = isBackOffice ? createAdminClient() : selfClient;

  let query = client
    .from("orders")
    .select("id, customer_id, analyst_id, total_amount, status, created_at")
    .eq("order_type", "detection_service")
    .order("created_at", { ascending: false });
  const { data: orders } = await query;
  if (!orders || orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const customerIds = [...new Set(orders.map((o) => o.customer_id).filter((id): id is string => !!id))];
  const analystIds = [...new Set(orders.map((o) => o.analyst_id).filter((id): id is string => !!id))];

  const admin = createAdminClient();
  const [{ data: customers }, { data: analysts }, { data: items }, { data: salesOrders }] = await Promise.all([
    customerIds.length > 0 ? admin.from("customers").select("id, party_id").in("id", customerIds) : Promise.resolve({ data: [] }),
    analystIds.length > 0 ? admin.from("analysts").select("id, party_id").in("id", analystIds) : Promise.resolve({ data: [] }),
    admin.from("order_items").select("order_id, item_type").in("order_id", orderIds),
    admin.from("sales_orders").select("order_id, status").in("order_id", orderIds),
  ]);

  const customerPartyById = new Map((customers ?? []).map((c) => [c.id, c.party_id]));
  const analystPartyById = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));
  const partyIds = [...new Set([...customerPartyById.values(), ...analystPartyById.values()])];
  const { data: identities } = await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds);
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));

  const itemTypeByOrder = new Map((items ?? []).map((i) => [i.order_id, i.item_type]));
  const reviewStatusByOrder = new Map((salesOrders ?? []).map((s) => [s.order_id, s.status]));

  let rows = orders.map((o) => {
    const customerParty = o.customer_id ? customerPartyById.get(o.customer_id) : null;
    const analystParty = o.analyst_id ? analystPartyById.get(o.analyst_id) : null;
    return {
      order_id: o.id,
      customer_name: (customerParty && nameByParty.get(customerParty)) ?? "—",
      analyst_name: (analystParty && nameByParty.get(analystParty)) ?? "—",
      item_type: itemTypeByOrder.get(o.id) ?? "—",
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

export interface SalesOrderDetail {
  order_id: string;
  customer_name: string;
  analyst_name: string;
  total_amount: number;
  order_status: string;
  sales_order_id: string;
  review_status: string;
  payment_screenshot_signed_url: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export async function getSalesOrderDetail(orderId: string): Promise<SalesOrderDetail | null> {
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, customer_id, analyst_id, total_amount, status, created_at")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return null;

  const { data: salesOrder } = await admin
    .from("sales_orders")
    .select("id, status, payment_screenshot_url, rejection_reason")
    .eq("order_id", orderId)
    .maybeSingle();
  if (!salesOrder) return null; // voucher-redemption orders have nothing to review

  const [{ data: customer }, { data: analyst }] = await Promise.all([
    order.customer_id ? admin.from("customers").select("party_id").eq("id", order.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    order.analyst_id ? admin.from("analysts").select("party_id").eq("id", order.analyst_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const partyIds = [customer?.party_id, analyst?.party_id].filter((id): id is string => !!id);
  const { data: identities } = await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds.length > 0 ? partyIds : ["00000000-0000-0000-0000-000000000000"]);
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));

  const screenshotUrl = await getSignedDocumentUrl("payment-screenshots", salesOrder.payment_screenshot_url);

  return {
    order_id: order.id,
    customer_name: (customer && nameByParty.get(customer.party_id)) ?? "—",
    analyst_name: (analyst && nameByParty.get(analyst.party_id)) ?? "—",
    total_amount: Number(order.total_amount),
    order_status: order.status,
    sales_order_id: salesOrder.id,
    review_status: salesOrder.status,
    payment_screenshot_signed_url: screenshotUrl,
    rejection_reason: salesOrder.rejection_reason,
    created_at: order.created_at,
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
