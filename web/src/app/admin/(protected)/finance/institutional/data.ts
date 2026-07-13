import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

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
}

// Institutional/B2B orders (orders.billing_mode = 'invoice', migration 016)
// are a separate additive path from the consumer walk-in Sales Order flow —
// this reads only billing_mode = 'invoice' orders, never touching the
// existing pay-now/voucher orders or the sales_orders review table. State
// and balances are derived from invoices/payments rather than stored, same
// convention as the rest of this codebase (e.g. commission totals).
export async function listInstitutionalOrders(): Promise<InstitutionalOrderRow[]> {
  const admin = createAdminClient();

  const { data: orders } = await admin
    .from("orders")
    .select("id, total_amount, status, created_at")
    .eq("billing_mode", "invoice")
    .order("created_at", { ascending: false });
  if (!orders || orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);

  const [{ data: items }, { data: invoices }, { data: payments }] = await Promise.all([
    admin.from("order_items").select("order_id, description, analyst_id").in("order_id", orderIds),
    admin.from("invoices").select("id, order_id, invoice_no, invoice_type, status, amount").in("order_id", orderIds),
    admin.from("payments").select("id, order_id, amount, payment_type, paid_at").in("order_id", orderIds),
  ]);

  const itemByOrder = new Map((items ?? []).map((it) => [it.order_id, it]));
  const analystIds = [...new Set((items ?? []).map((it) => it.analyst_id).filter((id): id is string => !!id))];
  const { data: analysts } = analystIds.length > 0 ? await admin.from("analysts").select("id, party_id").in("id", analystIds) : { data: [] };
  const analystPartyById = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));
  const partyIds = [...new Set([...analystPartyById.values()])];
  const { data: identities } = partyIds.length > 0 ? await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds) : { data: [] };
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));

  return orders.map((o) => {
    const item = itemByOrder.get(o.id);
    const analystParty = item?.analyst_id ? analystPartyById.get(item.analyst_id) : null;
    const orderInvoices = (invoices ?? []).filter((i) => i.order_id === o.id);
    const orderPayments = (payments ?? []).filter((p) => p.order_id === o.id);
    const depositTotal = orderPayments.filter((p) => p.payment_type === "deposit").reduce((s, p) => s + Number(p.amount), 0);
    const standardInvoice = orderInvoices.find((i) => i.invoice_type === "standard");
    const finalInvoice = orderInvoices.find((i) => i.invoice_type === "final_settlement");

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

    return {
      order_id: o.id,
      description: item?.description ?? "—",
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
    };
  });
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
// the printed document as the responsible agent/PIC. One order = one line
// item for institutional orders, so this is unambiguous.
async function getResponsibleAnalystName(admin: ReturnType<typeof createAdminClient>, orderId: string): Promise<string | null> {
  const { data: item } = await admin.from("order_items").select("analyst_id").eq("order_id", orderId).maybeSingle();
  if (!item?.analyst_id) return null;
  const { data: analyst } = await admin.from("analysts").select("party_id").eq("id", item.analyst_id).maybeSingle();
  if (!analyst) return null;
  const { data: identity } = await admin.from("individuals").select("full_name").eq("party_id", analyst.party_id).maybeSingle();
  return identity?.full_name ?? null;
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
  responsible_analyst_name: string | null;
  line_items: OrderLineItem[];
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
    responsible_analyst_name: await getResponsibleAnalystName(admin, invoice.order_id),
    line_items: (items ?? []).map((it) => ({
      description: it.description ?? "—",
      quantity: it.quantity,
      unit_price: Number(it.unit_price),
      subtotal: Number(it.subtotal),
    })),
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
  responsible_analyst_name: string | null;
  line_items: OrderLineItem[];
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
    responsible_analyst_name: await getResponsibleAnalystName(admin, payment.order_id),
    line_items: (items ?? []).map((it) => ({
      description: it.description ?? "—",
      quantity: it.quantity,
      unit_price: Number(it.unit_price),
      subtotal: Number(it.subtotal),
    })),
  };
}
