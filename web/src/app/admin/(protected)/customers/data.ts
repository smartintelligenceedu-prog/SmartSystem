import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export interface CustomerRow {
  customer_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  status: string;
  owner_analyst_id: string;
  owner_name: string;
  introducer_name: string | null;
  order_count: number;
  total_spent: number;
  created_at: string;
}

export interface CustomerListFilters {
  search?: string;
  status?: "active" | "inactive";
  ownerAnalystId?: string;
  introducerId?: string;
  createdFrom?: string;
  createdTo?: string;
  page?: number;
  pageSize?: number;
}

export interface CustomerListResult {
  rows: CustomerRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 20;

// Self-scope callers (analyst or introducer) read through their own RLS
// session — customers has SELECT policies for "own" (owner_analyst_id) and
// "referred" (acquired_via_introducer_id), so this works unmodified for
// either role. The merge lookups below always use the admin client, but
// only ever key off ids the caller's own customer rows already reference,
// so this never surfaces data beyond what the caller could already see.
//
// Search/pagination happen in application code rather than SQL: name/phone
// live on `individuals`, joined via party_id with no direct FK (same
// "no embedded select" constraint as everywhere else in this codebase), so
// a cross-table ilike isn't a single query. Given this is an SME's customer
// list (hundreds, not millions of rows), fetching the RLS/status/owner/date
// -filtered set and doing search + pagination in memory is simpler and fast
// enough — no need for a search-index or RPC.
export async function listCustomers(isBackOffice: boolean, filters: CustomerListFilters = {}): Promise<CustomerListResult> {
  const selfClient = await createServerSupabaseClient();
  const client = isBackOffice ? createAdminClient() : selfClient;

  let query = client
    .from("customers")
    .select("id, party_id, owner_analyst_id, acquired_via_introducer_id, status, created_at")
    .order("created_at", { ascending: false });

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.ownerAnalystId) query = query.eq("owner_analyst_id", filters.ownerAnalystId);
  if (filters.introducerId) query = query.eq("acquired_via_introducer_id", filters.introducerId);
  if (filters.createdFrom) query = query.gte("created_at", filters.createdFrom);
  if (filters.createdTo) query = query.lte("created_at", `${filters.createdTo}T23:59:59`);

  const { data: customers } = await query;
  if (!customers || customers.length === 0) {
    return { rows: [], totalCount: 0, page: filters.page ?? 1, pageSize: filters.pageSize ?? DEFAULT_PAGE_SIZE };
  }

  const partyIds = customers.map((c) => c.party_id);
  const analystIds = [...new Set(customers.map((c) => c.owner_analyst_id))];
  const introducerIds = [...new Set(customers.filter((c) => c.acquired_via_introducer_id).map((c) => c.acquired_via_introducer_id as string))];
  const customerIds = customers.map((c) => c.id);

  const admin = createAdminClient();
  const [{ data: analysts }, { data: introducers }, { data: items }] = await Promise.all([
    admin.from("analysts").select("id, party_id").in("id", analystIds),
    introducerIds.length > 0 ? admin.from("introducers").select("id, party_id").in("id", introducerIds) : Promise.resolve({ data: [] }),
    // detection_service orders no longer set orders.customer_id (migration
    // 012 — one order can cover several people) — order ownership per
    // customer now lives on order_items instead.
    admin.from("order_items").select("customer_id, subtotal, order_id").in("customer_id", customerIds).in("item_type", ["detection_session", "voucher_redemption"]),
  ]);
  const itemOrderIds = [...new Set((items ?? []).map((i) => i.order_id))];
  const { data: orders } = itemOrderIds.length > 0 ? await admin.from("orders").select("id, status").in("id", itemOrderIds) : { data: [] };
  const orderStatusById = new Map((orders ?? []).map((o) => [o.id, o.status]));

  const analystPartyById = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));
  const introducerPartyById = new Map((introducers ?? []).map((i) => [i.id, i.party_id]));

  const identityPartyIds = [...new Set([...partyIds, ...analystPartyById.values(), ...introducerPartyById.values()])];
  const { data: identities } = await admin.from("individuals").select("party_id, full_name, phone, email").in("party_id", identityPartyIds);
  const identityByParty = new Map((identities ?? []).map((i) => [i.party_id, i]));

  const orderStatsByCustomer = new Map<string, { count: number; total: number }>();
  for (const it of items ?? []) {
    const key = it.customer_id as string;
    const cur = orderStatsByCustomer.get(key) ?? { count: 0, total: 0 };
    cur.count += 1;
    if (orderStatusById.get(it.order_id) === "paid") cur.total += Number(it.subtotal);
    orderStatsByCustomer.set(key, cur);
  }

  let rows: CustomerRow[] = customers.map((c) => {
    const identity = identityByParty.get(c.party_id);
    const ownerParty = analystPartyById.get(c.owner_analyst_id);
    const ownerIdentity = ownerParty ? identityByParty.get(ownerParty) : null;
    const introducerParty = c.acquired_via_introducer_id ? introducerPartyById.get(c.acquired_via_introducer_id) : null;
    const introducerIdentity = introducerParty ? identityByParty.get(introducerParty) : null;
    const stats = orderStatsByCustomer.get(c.id) ?? { count: 0, total: 0 };

    return {
      customer_id: c.id,
      full_name: identity?.full_name ?? "—",
      phone: identity?.phone ?? null,
      email: identity?.email ?? null,
      status: c.status,
      owner_analyst_id: c.owner_analyst_id,
      owner_name: ownerIdentity?.full_name ?? "—",
      introducer_name: introducerIdentity?.full_name ?? null,
      order_count: stats.count,
      total_spent: stats.total,
      created_at: c.created_at,
    };
  });

  if (filters.search) {
    const term = filters.search.trim().toLowerCase();
    if (term) {
      rows = rows.filter(
        (row) => row.full_name.toLowerCase().includes(term) || (row.phone ?? "").toLowerCase().includes(term)
      );
    }
  }

  const totalCount = rows.length;
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, filters.page ?? 1);
  const start = (page - 1) * pageSize;
  const paged = rows.slice(start, start + pageSize);

  return { rows: paged, totalCount, page, pageSize };
}

export async function listActiveIntroducersForAttribution(): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  const { data: introducers } = await admin.from("introducers").select("id, party_id").eq("status", "active");
  if (!introducers || introducers.length === 0) return [];
  const { data: identities } = await admin
    .from("individuals")
    .select("party_id, full_name")
    .in("party_id", introducers.map((i) => i.party_id));
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));
  return introducers.map((i) => ({ id: i.id, name: nameByParty.get(i.party_id) ?? "—" }));
}

export async function listApprovedAgentsForFilter(): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  const { data: analysts } = await admin.from("analysts").select("id, party_id").eq("status", "approved");
  if (!analysts || analysts.length === 0) return [];
  const { data: identities } = await admin
    .from("individuals")
    .select("party_id, full_name")
    .in("party_id", analysts.map((a) => a.party_id));
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));
  return analysts.map((a) => ({ id: a.id, name: nameByParty.get(a.party_id) ?? "—" }));
}

export interface CustomerDetail {
  customer_id: string;
  party_id: string;
  owner_analyst_id: string;
  owner_name: string;
  acquired_via_introducer_id: string | null;
  introducer_name: string | null;
  status: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  gender: string | null;
  date_of_birth: string | null;
  occupation: string | null;
  marital_status: string | null;
  created_at: string;
}

export async function getCustomerDetail(customerId: string): Promise<CustomerDetail | null> {
  const admin = createAdminClient();
  const { data: customer } = await admin
    .from("customers")
    .select("id, party_id, owner_analyst_id, acquired_via_introducer_id, status, occupation, marital_status, created_at")
    .eq("id", customerId)
    .maybeSingle();
  if (!customer) return null;

  const [{ data: identity }, { data: analyst }, { data: introducer }] = await Promise.all([
    admin.from("individuals").select("full_name, phone, email, gender, date_of_birth").eq("party_id", customer.party_id).maybeSingle(),
    admin.from("analysts").select("party_id").eq("id", customer.owner_analyst_id).maybeSingle(),
    customer.acquired_via_introducer_id
      ? admin.from("introducers").select("party_id").eq("id", customer.acquired_via_introducer_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const [{ data: ownerIdentity }, { data: introducerIdentity }] = await Promise.all([
    analyst ? admin.from("individuals").select("full_name").eq("party_id", analyst.party_id).maybeSingle() : Promise.resolve({ data: null }),
    introducer ? admin.from("individuals").select("full_name").eq("party_id", introducer.party_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  return {
    customer_id: customer.id,
    party_id: customer.party_id,
    owner_analyst_id: customer.owner_analyst_id,
    owner_name: ownerIdentity?.full_name ?? "—",
    acquired_via_introducer_id: customer.acquired_via_introducer_id,
    introducer_name: introducerIdentity?.full_name ?? null,
    status: customer.status,
    full_name: identity?.full_name ?? "—",
    phone: identity?.phone ?? null,
    email: identity?.email ?? null,
    gender: identity?.gender ?? null,
    date_of_birth: identity?.date_of_birth ?? null,
    occupation: customer.occupation,
    marital_status: customer.marital_status,
    created_at: customer.created_at,
  };
}

export interface CustomerChild {
  id: string;
  full_name: string;
  gender: string | null;
  date_of_birth: string | null;
  school: string | null;
  remark: string | null;
}

export async function listCustomerChildren(customerId: string): Promise<CustomerChild[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("customer_children")
    .select("id, full_name, gender, date_of_birth, school, remark")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

export interface CustomerTimelineEntry {
  id: string;
  action: string;
  actor_name: string;
  occurred_at: string;
}

// Reuses the generic audit_logs table (entity_type = 'customer') rather than
// a customer-specific timeline table — this is exactly what audit_logs is
// for, and it means future modules (Sales Order, Report, Commission) can
// append to the same customer's timeline later without a new table either.
export async function listCustomerTimeline(customerId: string): Promise<CustomerTimelineEntry[]> {
  const admin = createAdminClient();
  const { data: logs } = await admin
    .from("audit_logs")
    .select("id, actor_user_id, action, occurred_at")
    .eq("entity_type", "customer")
    .eq("entity_id", customerId)
    .order("occurred_at", { ascending: false });
  if (!logs || logs.length === 0) return [];

  const userIds = [...new Set(logs.map((l) => l.actor_user_id).filter((id): id is string => !!id))];
  const { data: users } = userIds.length > 0 ? await admin.from("users").select("id, party_id").in("id", userIds) : { data: [] };
  const partyByUser = new Map((users ?? []).map((u) => [u.id, u.party_id]));
  const partyIds = [...partyByUser.values()];
  const { data: identities } = partyIds.length > 0 ? await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds) : { data: [] };
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));

  return logs.map((l) => {
    const party = l.actor_user_id ? partyByUser.get(l.actor_user_id) : null;
    return {
      id: l.id,
      action: l.action,
      actor_name: (party && nameByParty.get(party)) ?? "—",
      occurred_at: l.occurred_at,
    };
  });
}

export interface CustomerOrderRow {
  order_id: string;
  item_type: string;
  total_amount: number;
  status: string;
  created_at: string;
  report_delivered_at: string | null;
}

// detection_service orders no longer set orders.customer_id (migration 012
// — one order can cover several people), so "this customer's orders" means
// "order_items assigned to this customer". The amount/status shown are this
// customer's own line item, not the whole (possibly multi-person) order.
export async function listCustomerOrders(customerId: string): Promise<CustomerOrderRow[]> {
  const admin = createAdminClient();
  const { data: items } = await admin
    .from("order_items")
    .select("id, order_id, item_type, subtotal")
    .eq("customer_id", customerId)
    .in("item_type", ["detection_session", "voucher_redemption"]);
  if (!items || items.length === 0) return [];

  const { data: orders } = await admin
    .from("orders")
    .select("id, status, created_at, report_delivered_at")
    .in("id", items.map((i) => i.order_id));
  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));

  return items
    .map((it) => {
      const order = orderById.get(it.order_id);
      if (!order) return null;
      return {
        order_id: it.order_id,
        item_type: it.item_type,
        total_amount: Number(it.subtotal),
        status: order.status,
        created_at: order.created_at,
        report_delivered_at: order.report_delivered_at,
      };
    })
    .filter((row): row is CustomerOrderRow => row !== null)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export interface CustomerCommissionRow {
  id: string;
  trigger_type: string;
  commission_amount: number;
  status: string;
  calculated_at: string;
}

// Read-only, per the spec — Customer Detail only displays commission tied to
// this customer's orders, no adjustment action (that stays on /admin/commission).
// Commission for detection_service is calculated per order_item (migration
// 012), source_transaction_type = 'order_item' pointing at that item's id.
export async function listCustomerCommissions(customerId: string): Promise<CustomerCommissionRow[]> {
  const admin = createAdminClient();
  const { data: items } = await admin.from("order_items").select("id").eq("customer_id", customerId);
  const itemIds = (items ?? []).map((i) => i.id);
  if (itemIds.length === 0) return [];

  const { data: records } = await admin
    .from("commission_records")
    .select("id, trigger_type, commission_amount, status, calculated_at")
    .eq("source_transaction_type", "order_item")
    .in("source_transaction_id", itemIds)
    .order("calculated_at", { ascending: false });
  return (records ?? []).map((r) => ({
    id: r.id,
    trigger_type: r.trigger_type,
    commission_amount: Number(r.commission_amount),
    status: r.status,
    calculated_at: r.calculated_at,
  }));
}

export async function checkDuplicatePhone(phone: string, excludeCustomerId?: string): Promise<{ duplicatePhone: boolean }> {
  const admin = createAdminClient();
  const { data: customers } = await admin.from("customers").select("id, party_id");
  if (!customers || customers.length === 0) return { duplicatePhone: false };

  const partyIds = customers.filter((c) => c.id !== excludeCustomerId).map((c) => c.party_id);
  if (partyIds.length === 0) return { duplicatePhone: false };

  const { data: identities } = await admin.from("individuals").select("phone").in("party_id", partyIds);
  const duplicatePhone = (identities ?? []).some((i) => i.phone && i.phone === phone);

  return { duplicatePhone };
}
