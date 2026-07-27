import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

// A named line item's description ends " ( student name )" — for the list
// view's single summary line, strip that back off so "Ditoso 150 Package (
// Taner )" reads as just "Ditoso 150 Package" before the item-count suffix
// is appended.
function stripNameSuffix(description: string | null): string {
  if (!description) return "—";
  const stripped = description.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return stripped || description;
}

export type InstitutionalOrderState =
  | "no_invoice"
  | "invoiced_awaiting_payment"
  | "deposit_received_awaiting_settlement"
  | "settled_awaiting_final_payment"
  | "fully_paid"
  | "closed";

export interface InstitutionalOrderRow {
  order_id: string;
  description: string;
  total_amount: number;
  analyst_name: string | null;
  created_at: string;
  status: string;
  state: InstitutionalOrderState;
  invoice_no: string | null;
  invoice_id: string | null;
  latest_payment_id: string | null;
  ar_balance: number;
  deposit_balance: number;
  voucher_total: number;
  voucher_used: number;
  invoice_requested_at: string | null;
  // Migration 044 — which bulk package deal (if any) this batch counts
  // against, so back office can see at a glance which invoices are drawing
  // down a school's 100-credit deal vs a standalone one-off order.
  package_name: string | null;
  has_any_invoice_ever: boolean;
  is_deposit_order: boolean;
}

// Institutional/B2B orders (orders.billing_mode = 'invoice', migration 016)
// are a separate additive path from the consumer walk-in Sales Order flow —
// this reads only billing_mode = 'invoice' orders, never touching the
// existing pay-now/voucher orders or the sales_orders review table. State
// and balances are derived from invoices/payments rather than stored, same
// convention as the rest of this codebase (e.g. commission totals).
// scopedToAnalystId: when set (agent self-service view), only orders whose
// order_item.analyst_id matches are returned — an agent never sees another
// agent's institutional orders. Back office calls this with no argument.
export async function listInstitutionalOrders(scopedToAnalystId?: string): Promise<InstitutionalOrderRow[]> {
  const admin = createAdminClient();

  const { data: orders } = await admin
    .from("orders")
    .select("id, total_amount, status, created_at, invoice_requested_at, institutional_package_id, deposit_for_package_id")
    .eq("billing_mode", "invoice")
    .order("created_at", { ascending: false });
  if (!orders || orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const packageIds = [...new Set(orders.filter((o) => o.institutional_package_id).map((o) => o.institutional_package_id as string))];

  const [{ data: items }, { data: invoices }, { data: payments }, { data: vouchers }, { data: packages }] = await Promise.all([
    admin.from("order_items").select("order_id, description, analyst_id").in("order_id", orderIds),
    admin.from("invoices").select("id, order_id, invoice_no, invoice_type, status, amount").in("order_id", orderIds),
    admin.from("payments").select("id, order_id, amount, payment_type, paid_at").in("order_id", orderIds),
    admin.from("institutional_vouchers").select("order_id, status").in("order_id", orderIds),
    packageIds.length > 0 ? admin.from("institutional_packages").select("id, name").in("id", packageIds) : Promise.resolve({ data: [] }),
  ]);
  const packageNameById = new Map((packages ?? []).map((p) => [p.id, p.name]));

  // One order can have multiple order_items now (migration: per-student
  // named line items, see createInstitutionalOrder) — grouped by order_id
  // instead of keeping only the last one seen.
  const itemsByOrder = new Map<string, { order_id: string; description: string | null; analyst_id: string | null }[]>();
  for (const it of items ?? []) {
    const arr = itemsByOrder.get(it.order_id) ?? [];
    arr.push(it);
    itemsByOrder.set(it.order_id, arr);
  }
  // t() is async and can't be called inside the plain .map() below —
  // resolved once up front since it's the same string on every row.
  const itemCountSuffixTemplate = await t("finance.institutional.list.item_count_suffix");
  const analystIds = [...new Set((items ?? []).map((it) => it.analyst_id).filter((id): id is string => !!id))];
  const { data: analysts } = analystIds.length > 0 ? await admin.from("analysts").select("id, party_id").in("id", analystIds) : { data: [] };
  const analystPartyById = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));
  const partyIds = [...new Set([...analystPartyById.values()])];
  const { data: identities } = partyIds.length > 0 ? await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds) : { data: [] };
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));

  return orders
    .filter((o) => !scopedToAnalystId || (itemsByOrder.get(o.id) ?? []).some((it) => it.analyst_id === scopedToAnalystId))
    .map((o) => {
      const orderItems = itemsByOrder.get(o.id) ?? [];
      const firstItem = orderItems[0];
      const analystParty = firstItem?.analyst_id ? analystPartyById.get(firstItem.analyst_id) : null;
      const orderInvoices = (invoices ?? []).filter((i) => i.order_id === o.id);
      const orderPayments = (payments ?? []).filter((p) => p.order_id === o.id);
      const depositTotal = orderPayments.filter((p) => p.payment_type === "deposit").reduce((s, p) => s + Number(p.amount), 0);
      // Migration 047 — a voided invoice (status='void') no longer counts as
      // "this order has an invoice" here, so a voided order correctly falls
      // back to the 'no_invoice' state and becomes editable again.
      const standardInvoice = orderInvoices.find((i) => i.invoice_type === "standard" && i.status !== "void");
      const finalInvoice = orderInvoices.find((i) => i.invoice_type === "final_settlement" && i.status !== "void");

      let state: InstitutionalOrderState;
      let arBalance = 0;
      let depositBalance = 0;
      let invoiceNo: string | null = null;
      let invoiceId: string | null = null;

      if (o.status === "paid") {
        state = "fully_paid";
      } else if (o.status === "cancelled" || o.status === "refunded") {
        state = "closed";
      } else if (finalInvoice) {
        state = "settled_awaiting_final_payment";
        arBalance = Number(finalInvoice.amount) - depositTotal;
        invoiceNo = finalInvoice.invoice_no;
        invoiceId = finalInvoice.id;
      } else if (standardInvoice) {
        state = "invoiced_awaiting_payment";
        arBalance = Number(standardInvoice.amount);
        invoiceNo = standardInvoice.invoice_no;
        invoiceId = standardInvoice.id;
      } else if (depositTotal > 0) {
        state = "deposit_received_awaiting_settlement";
        depositBalance = depositTotal;
      } else {
        state = "no_invoice";
      }

      // If there's no active standard/final invoice (either state above), an
      // order can still have an invoice on record once fully paid — surface
      // whichever invoice exists so "查看发票" keeps working after settlement.
      if (!invoiceId && orderInvoices.length > 0) {
        const latest = [...orderInvoices].sort((a, b) => (a.id < b.id ? 1 : -1))[0];
        invoiceId = latest.id;
        invoiceNo = latest.invoice_no;
      }

      const latestPayment = [...orderPayments].sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime())[0];

      const orderVouchers = (vouchers ?? []).filter((v) => v.order_id === o.id);
      const voucherUsed = orderVouchers.filter((v) => v.status === "used").length;

      const description =
        orderItems.length <= 1
          ? (orderItems[0]?.description ?? "—")
          : `${stripNameSuffix(orderItems[0].description)}${itemCountSuffixTemplate.replace("{count}", String(orderItems.length))}`;

      return {
        order_id: o.id,
        description,
        total_amount: Number(o.total_amount),
        analyst_name: (analystParty && nameByParty.get(analystParty)) ?? null,
        created_at: o.created_at,
        status: o.status,
        state,
        invoice_no: invoiceNo,
        invoice_id: invoiceId,
        latest_payment_id: latestPayment?.id ?? null,
        ar_balance: arBalance,
        deposit_balance: depositBalance,
        voucher_total: orderVouchers.length,
        voucher_used: voucherUsed,
        invoice_requested_at: o.invoice_requested_at,
        package_name: o.institutional_package_id ? (packageNameById.get(o.institutional_package_id) ?? null) : null,
        // Migration 047 — distinguishes "never invoiced" (safe to fully
        // delete) from "was invoiced then voided" (edit-only, since the void
        // invoice's order_id linkage must be kept — see actions.ts).
        has_any_invoice_ever: orderInvoices.length > 0,
        // Deposit shell orders (migration 046) have their own single 'other'
        // item and no per-student rows — edit is hidden for these in the UI,
        // only delete (before any invoice) or leaving them as-is otherwise.
        is_deposit_order: !!o.deposit_for_package_id,
      };
    });
}

export interface EditableOrderRow {
  name: string;
  analyst_id: string | null;
}

export interface InstitutionalOrderForEdit {
  order_id: string;
  item_name: string;
  unit_price: number;
  rows: EditableOrderRow[];
  package_name: string | null;
}

// Migration 047 — prefills the edit dialog. Every order_item in one
// institutional order shares the same item_name/unit_price by construction
// (createInstitutionalOrder), so it's safe to read them off the first row;
// the per-row student name is recovered from the " ( name )" suffix that
// same function appends to each item's description.
export async function getInstitutionalOrderForEdit(orderId: string): Promise<InstitutionalOrderForEdit | null> {
  const admin = createAdminClient();

  const { data: order } = await admin.from("orders").select("id, institutional_package_id").eq("id", orderId).maybeSingle();
  if (!order) return null;

  const { data: items } = await admin.from("order_items").select("description, unit_price, analyst_id").eq("order_id", orderId);
  if (!items || items.length === 0) return null;

  let packageName: string | null = null;
  if (order.institutional_package_id) {
    const { data: pkg } = await admin.from("institutional_packages").select("name").eq("id", order.institutional_package_id).maybeSingle();
    packageName = pkg?.name ?? null;
  }

  return {
    order_id: order.id,
    item_name: stripNameSuffix(items[0].description),
    unit_price: Number(items[0].unit_price),
    rows: items.map((it) => {
      const match = it.description?.match(/\(([^)]*)\)\s*$/);
      return { name: match ? match[1].trim() : "", analyst_id: it.analyst_id };
    }),
    package_name: packageName,
  };
}

export interface PackageRow {
  id: string;
  institution_party_id: string;
  institution_name: string;
  name: string;
  total_credits: number;
  used_credits: number;
  unit_price: number;
  deposit_amount: number | null;
  deposit_received_at: string | null;
  status: string;
  created_at: string;
  // Migration 045 — optional fixed commission for this deal, mirroring
  // channel_campaigns' pic_report_override_amount / pic_analyst_report_fee_amount.
  responsible_analyst_id: string | null;
  responsible_analyst_name: string | null;
  report_override_amount: number | null;
  analyst_report_fee_amount: number | null;
  // Migration 048 — flat commission paid to responsible_analyst_id the
  // moment the deposit payment is actually recorded.
  deposit_commission_amount: number | null;
  // Migration 046 — the shell order that collects this package's deposit, if
  // any (older packages get one via a one-time backfill; new ones get it at
  // creation whenever deposit_amount is set). Lets the packages table link
  // straight to that order's row in the list above to record/view payment.
  deposit_order_id: string | null;
}

// A negotiated bulk deal (migration 044) — "used" is derived by summing
// order_items.quantity across every non-cancelled/non-refunded order linked
// via institutional_package_id, NOT a pre-issued voucher pool (see the
// header comment on the migration for why: a deposit-only deal has no full
// payment to trigger institutional_vouchers' generation, but batches still
// need to invoice and count down against the agreed total as they happen).
export async function listPackages(): Promise<PackageRow[]> {
  const admin = createAdminClient();
  const { data: packages } = await admin
    .from("institutional_packages")
    .select(
      "id, institution_party_id, name, total_credits, unit_price, deposit_amount, deposit_received_at, status, created_at, responsible_analyst_id, report_override_amount, analyst_report_fee_amount, deposit_commission_amount"
    )
    .order("created_at", { ascending: false });
  if (!packages || packages.length === 0) return [];

  const packageIds = packages.map((p) => p.id);
  const institutionPartyIds = [...new Set(packages.map((p) => p.institution_party_id))];
  const responsibleAnalystIds = [...new Set(packages.filter((p) => p.responsible_analyst_id).map((p) => p.responsible_analyst_id as string))];

  const [{ data: orders }, { data: orgs }, { data: responsibleAnalysts }, { data: depositOrders }] = await Promise.all([
    admin.from("orders").select("id, institutional_package_id").in("institutional_package_id", packageIds).not("status", "in", "(cancelled,refunded)"),
    admin.from("organizations").select("party_id, legal_name").in("party_id", institutionPartyIds),
    responsibleAnalystIds.length > 0 ? admin.from("analysts").select("id, party_id").in("id", responsibleAnalystIds) : Promise.resolve({ data: [] }),
    admin.from("orders").select("id, deposit_for_package_id").in("deposit_for_package_id", packageIds),
  ]);
  const depositOrderIdByPackage = new Map((depositOrders ?? []).map((o) => [o.deposit_for_package_id as string, o.id]));
  const orgNameByParty = new Map((orgs ?? []).map((o) => [o.party_id, o.legal_name]));
  const analystPartyById = new Map((responsibleAnalysts ?? []).map((a) => [a.id, a.party_id]));
  const responsiblePartyIds = [...new Set([...analystPartyById.values()])];
  const { data: responsibleIdentities } =
    responsiblePartyIds.length > 0 ? await admin.from("individuals").select("party_id, full_name").in("party_id", responsiblePartyIds) : { data: [] };
  const responsibleNameByParty = new Map((responsibleIdentities ?? []).map((i) => [i.party_id, i.full_name]));

  const orderIdsByPackage = new Map<string, string[]>();
  for (const o of orders ?? []) {
    if (!o.institutional_package_id) continue;
    const arr = orderIdsByPackage.get(o.institutional_package_id) ?? [];
    arr.push(o.id);
    orderIdsByPackage.set(o.institutional_package_id, arr);
  }
  const allOrderIds = (orders ?? []).map((o) => o.id);
  const { data: items } =
    allOrderIds.length > 0 ? await admin.from("order_items").select("order_id, quantity").in("order_id", allOrderIds) : { data: [] };
  const quantityByOrder = new Map<string, number>();
  for (const it of items ?? []) {
    quantityByOrder.set(it.order_id, (quantityByOrder.get(it.order_id) ?? 0) + it.quantity);
  }

  return packages.map((p) => {
    const orderIds = orderIdsByPackage.get(p.id) ?? [];
    const usedCredits = orderIds.reduce((sum, id) => sum + (quantityByOrder.get(id) ?? 0), 0);
    return {
      id: p.id,
      institution_party_id: p.institution_party_id,
      institution_name: orgNameByParty.get(p.institution_party_id) ?? "—",
      name: p.name,
      total_credits: p.total_credits,
      used_credits: usedCredits,
      unit_price: Number(p.unit_price),
      deposit_amount: p.deposit_amount === null ? null : Number(p.deposit_amount),
      deposit_received_at: p.deposit_received_at,
      status: p.status,
      created_at: p.created_at,
      responsible_analyst_id: p.responsible_analyst_id,
      responsible_analyst_name: p.responsible_analyst_id
        ? (responsibleNameByParty.get(analystPartyById.get(p.responsible_analyst_id) ?? "") ?? null)
        : null,
      report_override_amount: p.report_override_amount === null ? null : Number(p.report_override_amount),
      analyst_report_fee_amount: p.analyst_report_fee_amount === null ? null : Number(p.analyst_report_fee_amount),
      deposit_commission_amount: p.deposit_commission_amount === null ? null : Number(p.deposit_commission_amount),
      deposit_order_id: depositOrderIdByPackage.get(p.id) ?? null,
    };
  });
}

export interface PackageOption {
  id: string;
  name: string;
  institution_party_id: string;
  institution_name: string;
  unit_price: number;
  total_credits: number;
  used_credits: number;
}

// For the Institutional Order creation form's "所属套餐" picker — active
// packages only, reusing listPackages()'s used-credit derivation.
export async function listActivePackageOptions(): Promise<PackageOption[]> {
  const packages = await listPackages();
  return packages
    .filter((p) => p.status === "active")
    .map((p) => ({
      id: p.id,
      name: p.name,
      institution_party_id: p.institution_party_id,
      institution_name: p.institution_name,
      unit_price: p.unit_price,
      total_credits: p.total_credits,
      used_credits: p.used_credits,
    }));
}

export interface InstitutionOption {
  party_id: string;
  legal_name: string;
  ssm_number: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
}

// Every institution that already has a formal billing identity (parties/
// organizations/addresses) somewhere in the system — sourced from BOTH
// Institutional Orders (orders.institution_party_id) and PIC channel
// campaigns (channel_campaigns.institution_party_id, migration 043) — so
// creating an order for a school that already ran a campaign (or vice
// versa) reuses the same record instead of retyping SSM/address again.
export async function listInstitutionOptions(): Promise<InstitutionOption[]> {
  const admin = createAdminClient();
  const [{ data: orderParties }, { data: campaignParties }] = await Promise.all([
    admin.from("orders").select("institution_party_id").not("institution_party_id", "is", null),
    admin.from("channel_campaigns").select("institution_party_id").not("institution_party_id", "is", null),
  ]);
  const partyIds = [
    ...new Set([
      ...(orderParties ?? []).map((o) => o.institution_party_id as string),
      ...(campaignParties ?? []).map((c) => c.institution_party_id as string),
    ]),
  ];
  if (partyIds.length === 0) return [];

  const [{ data: orgs }, { data: addresses }] = await Promise.all([
    admin.from("organizations").select("party_id, legal_name, registration_no, phone").in("party_id", partyIds),
    admin.from("addresses").select("party_id, line1, line2, city, state, postcode").in("party_id", partyIds).eq("is_primary", true),
  ]);
  const addressByParty = new Map((addresses ?? []).map((a) => [a.party_id, a]));

  return (orgs ?? [])
    .map((o) => {
      const addr = addressByParty.get(o.party_id);
      return {
        party_id: o.party_id,
        legal_name: o.legal_name,
        ssm_number: o.registration_no,
        phone: o.phone,
        address_line1: addr?.line1 ?? null,
        address_line2: addr?.line2 ?? null,
        city: addr?.city ?? null,
        state: addr?.state ?? null,
        postcode: addr?.postcode ?? null,
      };
    })
    .sort((a, b) => a.legal_name.localeCompare(b.legal_name));
}

export interface BillingEntity {
  legal_name: string;
  ssm_number: string | null;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
}

export interface OrderLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

async function getBillingEntity(admin: ReturnType<typeof createAdminClient>, institutionPartyId: string | null): Promise<BillingEntity | null> {
  if (!institutionPartyId) return null;
  const [{ data: org }, { data: address }] = await Promise.all([
    admin.from("organizations").select("legal_name, registration_no, phone, email").eq("party_id", institutionPartyId).maybeSingle(),
    admin.from("addresses").select("line1, line2, city, state, postcode").eq("party_id", institutionPartyId).eq("is_primary", true).maybeSingle(),
  ]);
  if (!org) return null;
  return {
    legal_name: org.legal_name,
    ssm_number: org.registration_no,
    phone: org.phone,
    email: org.email,
    address_line1: address?.line1 ?? null,
    address_line2: address?.line2 ?? null,
    city: address?.city ?? null,
    state: address?.state ?? null,
    postcode: address?.postcode ?? null,
  };
}

// Same "归属分析师" set on the order_items row at order creation — shown on
// the printed document as the responsible agent/PIC, and used to gate an
// agent's read access to their own invoice/receipt (see invoices/[id] and
// payments/[id] pages). One order = one line item for institutional orders,
// so this is unambiguous.
async function getResponsibleAnalyst(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string
): Promise<{ id: string | null; name: string | null }> {
  const { data: item } = await admin.from("order_items").select("analyst_id").eq("order_id", orderId).maybeSingle();
  if (!item?.analyst_id) return { id: null, name: null };
  const { data: analyst } = await admin.from("analysts").select("party_id").eq("id", item.analyst_id).maybeSingle();
  if (!analyst) return { id: item.analyst_id, name: null };
  const { data: identity } = await admin.from("individuals").select("full_name").eq("party_id", analyst.party_id).maybeSingle();
  return { id: item.analyst_id, name: identity?.full_name ?? null };
}

export interface PackageRemainingInfo {
  name: string;
  total_credits: number;
  used_credits: number;
}

// Migration 044 — how many credits remain on the bulk package this order
// counts against, if any. Same derivation as listPackages()'s used_credits
// (sum of order_items.quantity across every non-cancelled/non-refunded
// order linked to the package), so it stays correct as more batches get
// invoiced over time.
async function getPackageRemaining(admin: ReturnType<typeof createAdminClient>, orderId: string): Promise<PackageRemainingInfo | null> {
  const { data: order } = await admin.from("orders").select("institutional_package_id").eq("id", orderId).maybeSingle();
  if (!order?.institutional_package_id) return null;

  const { data: pkg } = await admin
    .from("institutional_packages")
    .select("name, total_credits")
    .eq("id", order.institutional_package_id)
    .maybeSingle();
  if (!pkg) return null;

  const { data: linkedOrders } = await admin
    .from("orders")
    .select("id")
    .eq("institutional_package_id", order.institutional_package_id)
    .not("status", "in", "(cancelled,refunded)");
  const orderIds = (linkedOrders ?? []).map((o) => o.id);
  const { data: items } =
    orderIds.length > 0 ? await admin.from("order_items").select("quantity").in("order_id", orderIds) : { data: [] };
  const usedCredits = (items ?? []).reduce((sum, it) => sum + it.quantity, 0);

  return { name: pkg.name, total_credits: pkg.total_credits, used_credits: usedCredits };
}

export interface PackageDepositInfo {
  package_name: string;
  total_credits: number;
  unit_price: number;
  deposit_amount: number;
  deposit_received_at: string | null;
  total_value: number;
  // Rounded % that deposit_amount represents of the package's full agreed
  // value (total_credits × unit_price) — purely informational context for
  // the printed document, e.g. "10% of the RM38,800 package total".
  percent_of_total: number;
  // true when the order THIS document is for IS the deposit shell order
  // itself (migration 046); false when it's a regular batch order under the
  // same package, shown alongside package_remaining as a reminder that a
  // deposit exists to be manually netted off a later invoice.
  is_deposit_order: boolean;
}

// Migration 046 — surfaces a package's deposit terms on printed documents so
// back office has the context to manually apply it later (e.g. discounting
// the final batch's invoice) — this project deliberately does NOT automate
// that netting, per the user's explicit choice to keep it a manual step.
async function getPackageDepositInfo(admin: ReturnType<typeof createAdminClient>, orderId: string): Promise<PackageDepositInfo | null> {
  const { data: order } = await admin.from("orders").select("institutional_package_id, deposit_for_package_id").eq("id", orderId).maybeSingle();
  const packageId = order?.institutional_package_id ?? order?.deposit_for_package_id;
  if (!packageId) return null;

  const { data: pkg } = await admin
    .from("institutional_packages")
    .select("name, total_credits, unit_price, deposit_amount, deposit_received_at")
    .eq("id", packageId)
    .maybeSingle();
  if (!pkg || pkg.deposit_amount === null) return null;

  const totalValue = pkg.total_credits * Number(pkg.unit_price);
  const percent = totalValue > 0 ? Math.round((Number(pkg.deposit_amount) / totalValue) * 100) : 0;

  return {
    package_name: pkg.name,
    total_credits: pkg.total_credits,
    unit_price: Number(pkg.unit_price),
    deposit_amount: Number(pkg.deposit_amount),
    deposit_received_at: pkg.deposit_received_at,
    total_value: totalValue,
    percent_of_total: percent,
    is_deposit_order: !!order?.deposit_for_package_id,
  };
}

export interface InvoiceDetail {
  invoice_id: string;
  invoice_no: string;
  invoice_type: "standard" | "final_settlement";
  status: string;
  amount: number;
  ar_balance: number;
  issued_at: string;
  order_id: string;
  billing_entity: BillingEntity | null;
  responsible_analyst_id: string | null;
  responsible_analyst_name: string | null;
  line_items: OrderLineItem[];
  package_remaining: PackageRemainingInfo | null;
  package_deposit_info: PackageDepositInfo | null;
}

// Powers the printable invoice page — a fully-settled ('paid') invoice
// renders a PAID watermark; an 'issued' invoice shows the outstanding
// balance due, computed the same way listInstitutionalOrders() derives
// ar_balance (deposits netted off for final_settlement invoices).
export async function getInvoiceDetail(invoiceId: string): Promise<InvoiceDetail | null> {
  const admin = createAdminClient();

  const { data: invoice } = await admin
    .from("invoices")
    .select("id, order_id, invoice_no, invoice_type, status, amount, issued_at")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return null;

  const [{ data: order }, { data: items }] = await Promise.all([
    admin.from("orders").select("institution_party_id").eq("id", invoice.order_id).maybeSingle(),
    admin.from("order_items").select("description, quantity, unit_price, subtotal").eq("order_id", invoice.order_id),
  ]);

  let arBalance = 0;
  if (invoice.status === "issued") {
    if (invoice.invoice_type === "final_settlement") {
      const { data: deposits } = await admin.from("payments").select("amount").eq("order_id", invoice.order_id).eq("payment_type", "deposit");
      const depositTotal = (deposits ?? []).reduce((s, d) => s + Number(d.amount), 0);
      arBalance = Number(invoice.amount) - depositTotal;
    } else {
      arBalance = Number(invoice.amount);
    }
  }

  const responsibleAnalyst = await getResponsibleAnalyst(admin, invoice.order_id);

  return {
    invoice_id: invoice.id,
    invoice_no: invoice.invoice_no,
    invoice_type: invoice.invoice_type as "standard" | "final_settlement",
    status: invoice.status,
    amount: Number(invoice.amount),
    ar_balance: arBalance,
    issued_at: invoice.issued_at,
    order_id: invoice.order_id,
    billing_entity: await getBillingEntity(admin, order?.institution_party_id ?? null),
    responsible_analyst_id: responsibleAnalyst.id,
    responsible_analyst_name: responsibleAnalyst.name,
    line_items: (items ?? []).map((it) => ({
      description: it.description ?? "—",
      quantity: it.quantity,
      unit_price: Number(it.unit_price),
      subtotal: Number(it.subtotal),
    })),
    package_remaining: await getPackageRemaining(admin, invoice.order_id),
    package_deposit_info: await getPackageDepositInfo(admin, invoice.order_id),
  };
}

export interface PaymentDetail {
  payment_id: string;
  receipt_no: string | null;
  amount: number;
  method: string;
  payment_type: "deposit" | "full_payment" | "final_payment";
  paid_at: string;
  reference_no: string | null;
  order_id: string;
  billing_entity: BillingEntity | null;
  responsible_analyst_id: string | null;
  responsible_analyst_name: string | null;
  line_items: OrderLineItem[];
  package_remaining: PackageRemainingInfo | null;
  package_deposit_info: PackageDepositInfo | null;
}

export async function getPaymentDetail(paymentId: string): Promise<PaymentDetail | null> {
  const admin = createAdminClient();

  const { data: payment } = await admin
    .from("payments")
    .select("id, order_id, amount, method, payment_type, paid_at, reference_no")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment) return null;

  const [{ data: order }, { data: items }, { data: receipt }] = await Promise.all([
    admin.from("orders").select("institution_party_id").eq("id", payment.order_id).maybeSingle(),
    admin.from("order_items").select("description, quantity, unit_price, subtotal").eq("order_id", payment.order_id),
    admin.from("receipts").select("receipt_no").eq("payment_id", payment.id).maybeSingle(),
  ]);

  const responsibleAnalyst = await getResponsibleAnalyst(admin, payment.order_id);

  return {
    payment_id: payment.id,
    receipt_no: receipt?.receipt_no ?? null,
    amount: Number(payment.amount),
    method: payment.method,
    payment_type: payment.payment_type as "deposit" | "full_payment" | "final_payment",
    paid_at: payment.paid_at,
    reference_no: payment.reference_no,
    order_id: payment.order_id,
    billing_entity: await getBillingEntity(admin, order?.institution_party_id ?? null),
    responsible_analyst_id: responsibleAnalyst.id,
    responsible_analyst_name: responsibleAnalyst.name,
    line_items: (items ?? []).map((it) => ({
      description: it.description ?? "—",
      quantity: it.quantity,
      unit_price: Number(it.unit_price),
      subtotal: Number(it.subtotal),
    })),
    package_remaining: await getPackageRemaining(admin, payment.order_id),
    package_deposit_info: await getPackageDepositInfo(admin, payment.order_id),
  };
}
