import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

export interface PayoutRunRow {
  id: string;
  period_start: string;
  period_end: string;
  processed_at: string;
  analyst_payout_total: number;
  introducer_payout_total: number;
}

export async function listPayoutRuns(): Promise<PayoutRunRow[]> {
  const admin = createAdminClient();
  const { data: runs } = await admin
    .from("commission_payout_runs")
    .select("id, period_start, period_end, processed_at")
    .order("period_start", { ascending: false });
  if (!runs || runs.length === 0) return [];

  const runIds = runs.map((r) => r.id);
  const [{ data: payslips }, { data: statements }] = await Promise.all([
    admin.from("analyst_payslips").select("payout_run_id, gross_amount").in("payout_run_id", runIds),
    admin.from("introducer_commission_statements").select("payout_run_id, gross_amount").in("payout_run_id", runIds),
  ]);

  return runs.map((r) => ({
    id: r.id,
    period_start: r.period_start,
    period_end: r.period_end,
    processed_at: r.processed_at,
    analyst_payout_total: (payslips ?? []).filter((p) => p.payout_run_id === r.id).reduce((s, p) => s + Number(p.gross_amount), 0),
    introducer_payout_total: (statements ?? []).filter((s) => s.payout_run_id === r.id).reduce((s, st) => s + Number(st.gross_amount), 0),
  }));
}

export interface PayoutRunDetail {
  id: string;
  period_start: string;
  period_end: string;
  analyst_lines: { payslip_id: string; analyst_name: string; gross_amount: number }[];
  introducer_lines: { statement_id: string; introducer_name: string; gross_amount: number }[];
}

export async function getPayoutRunDetail(runId: string): Promise<PayoutRunDetail | null> {
  const admin = createAdminClient();
  const { data: run } = await admin.from("commission_payout_runs").select("id, period_start, period_end").eq("id", runId).maybeSingle();
  if (!run) return null;

  const [{ data: payslips }, { data: statements }] = await Promise.all([
    admin.from("analyst_payslips").select("id, analyst_id, gross_amount").eq("payout_run_id", runId),
    admin.from("introducer_commission_statements").select("id, introducer_id, gross_amount").eq("payout_run_id", runId),
  ]);

  const analystIds = (payslips ?? []).map((p) => p.analyst_id);
  const introducerIds = (statements ?? []).map((s) => s.introducer_id);
  const [{ data: analysts }, { data: introducers }] = await Promise.all([
    analystIds.length > 0 ? admin.from("analysts").select("id, party_id").in("id", analystIds) : Promise.resolve({ data: [] }),
    introducerIds.length > 0 ? admin.from("introducers").select("id, party_id").in("id", introducerIds) : Promise.resolve({ data: [] }),
  ]);
  const partyIds = [...(analysts ?? []).map((a) => a.party_id), ...(introducers ?? []).map((i) => i.party_id)];
  const { data: identities } =
    partyIds.length > 0 ? await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds) : { data: [] };
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));
  const analystPartyById = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));
  const introducerPartyById = new Map((introducers ?? []).map((i) => [i.id, i.party_id]));

  return {
    id: run.id,
    period_start: run.period_start,
    period_end: run.period_end,
    analyst_lines: (payslips ?? []).map((p) => ({
      payslip_id: p.id,
      analyst_name: nameByParty.get(analystPartyById.get(p.analyst_id) ?? "") ?? "—",
      gross_amount: Number(p.gross_amount),
    })),
    introducer_lines: (statements ?? []).map((s) => ({
      statement_id: s.id,
      introducer_name: nameByParty.get(introducerPartyById.get(s.introducer_id) ?? "") ?? "—",
      gross_amount: Number(s.gross_amount),
    })),
  };
}

export interface CommissionLineItem {
  commission_record_id: string;
  trigger_type: string;
  commission_amount: number;
  calculated_at: string;
  description: string;
}

// Resolves commission_records' polymorphic source_transaction_type/id into a
// human-readable "which child / which institution / who was recruited" line
// for the payslip/statement drill-down — this is the "贡献明细穿透" the CTO
// asked for, so a payee can see exactly why each line item was earned.
async function describeSourceTransactions(
  admin: ReturnType<typeof createAdminClient>,
  records: { source_transaction_type: string; source_transaction_id: string }[]
): Promise<Map<string, string>> {
  const orderItemIds = records.filter((r) => r.source_transaction_type === "order_item").map((r) => r.source_transaction_id);
  const orderIds = records.filter((r) => r.source_transaction_type === "order").map((r) => r.source_transaction_id);

  const descByKey = new Map<string, string>();

  if (orderItemIds.length > 0) {
    const { data: items } = await admin
      .from("order_items")
      .select("id, description, customer_id, order_id")
      .in("id", orderItemIds);
    const customerIds = [...new Set((items ?? []).map((i) => i.customer_id).filter((id): id is string => !!id))];
    const itemOrderIds = [...new Set((items ?? []).map((i) => i.order_id))];

    const [{ data: customers }, { data: orders }] = await Promise.all([
      customerIds.length > 0 ? admin.from("customers").select("id, party_id").in("id", customerIds) : Promise.resolve({ data: [] }),
      itemOrderIds.length > 0 ? admin.from("orders").select("id, institution_party_id").in("id", itemOrderIds) : Promise.resolve({ data: [] }),
    ]);
    const customerPartyById = new Map((customers ?? []).map((c) => [c.id, c.party_id]));
    const institutionPartyByOrder = new Map((orders ?? []).map((o) => [o.id, o.institution_party_id]));

    const partyIds = [...new Set([...customerPartyById.values(), ...institutionPartyByOrder.values()].filter((id): id is string => !!id))];
    const [{ data: individuals }, { data: orgs }] =
      partyIds.length > 0
        ? await Promise.all([
            admin.from("individuals").select("party_id, full_name").in("party_id", partyIds),
            admin.from("organizations").select("party_id, legal_name").in("party_id", partyIds),
          ])
        : [{ data: [] }, { data: [] }];
    const nameByParty = new Map<string, string>();
    for (const i of individuals ?? []) nameByParty.set(i.party_id, i.full_name);
    for (const o of orgs ?? []) nameByParty.set(o.party_id, o.legal_name);

    for (const item of items ?? []) {
      const customerParty = item.customer_id ? customerPartyById.get(item.customer_id) : null;
      const institutionParty = institutionPartyByOrder.get(item.order_id);
      const who = (customerParty && nameByParty.get(customerParty)) ?? (institutionParty && nameByParty.get(institutionParty)) ?? null;
      const label = who ? `${who} - ${item.description ?? "—"}` : (item.description ?? "—");
      descByKey.set(`order_item:${item.id}`, label);
    }
  }

  if (orderIds.length > 0) {
    const { data: regOrders } = await admin.from("registration_orders").select("order_id, party_id").in("order_id", orderIds);
    const partyIds = [...new Set((regOrders ?? []).map((r) => r.party_id))];
    const { data: individuals } =
      partyIds.length > 0 ? await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds) : { data: [] };
    const nameByParty = new Map((individuals ?? []).map((i) => [i.party_id, i.full_name]));

    for (const regOrder of regOrders ?? []) {
      const name = nameByParty.get(regOrder.party_id) ?? "—";
      descByKey.set(`order:${regOrder.order_id}`, `${t("payroll.line_item.recruited_prefix")} ${name} ${t("payroll.line_item.recruited_suffix")}`);
    }
  }

  return descByKey;
}

async function buildLineItems(
  admin: ReturnType<typeof createAdminClient>,
  records: { id: string; trigger_type: string; commission_amount: number; calculated_at: string; source_transaction_type: string; source_transaction_id: string }[]
): Promise<CommissionLineItem[]> {
  const descByKey = await describeSourceTransactions(admin, records);
  return records
    .map((r) => ({
      commission_record_id: r.id,
      trigger_type: r.trigger_type,
      commission_amount: Number(r.commission_amount),
      calculated_at: r.calculated_at,
      description: descByKey.get(`${r.source_transaction_type}:${r.source_transaction_id}`) ?? "—",
    }))
    .sort((a, b) => a.calculated_at.localeCompare(b.calculated_at));
}

export interface AnalystPayslipRow {
  id: string;
  payout_run_id: string;
  period_start: string;
  period_end: string;
  gross_amount: number;
}

export async function listAnalystPayslips(analystId: string): Promise<AnalystPayslipRow[]> {
  const admin = createAdminClient();
  const { data: payslips } = await admin
    .from("analyst_payslips")
    .select("id, payout_run_id, gross_amount")
    .eq("analyst_id", analystId)
    .order("created_at", { ascending: false });
  if (!payslips || payslips.length === 0) return [];

  const runIds = payslips.map((p) => p.payout_run_id);
  const { data: runs } = await admin.from("commission_payout_runs").select("id, period_start, period_end").in("id", runIds);
  const runById = new Map((runs ?? []).map((r) => [r.id, r]));

  return payslips.map((p) => {
    const run = runById.get(p.payout_run_id);
    return {
      id: p.id,
      payout_run_id: p.payout_run_id,
      period_start: run?.period_start ?? "",
      period_end: run?.period_end ?? "",
      gross_amount: Number(p.gross_amount),
    };
  });
}

export interface AnalystPayslipDetail extends AnalystPayslipRow {
  analyst_id: string;
  analyst_name: string;
  line_items: CommissionLineItem[];
}

export async function getAnalystPayslipDetail(payslipId: string): Promise<AnalystPayslipDetail | null> {
  const admin = createAdminClient();
  const { data: payslip } = await admin
    .from("analyst_payslips")
    .select("id, payout_run_id, analyst_id, gross_amount")
    .eq("id", payslipId)
    .maybeSingle();
  if (!payslip) return null;

  const [{ data: run }, { data: analyst }] = await Promise.all([
    admin.from("commission_payout_runs").select("period_start, period_end").eq("id", payslip.payout_run_id).maybeSingle(),
    admin.from("analysts").select("party_id").eq("id", payslip.analyst_id).maybeSingle(),
  ]);
  const { data: identity } = analyst ? await admin.from("individuals").select("full_name").eq("party_id", analyst.party_id).maybeSingle() : { data: null };

  const { data: records } = await admin
    .from("commission_records")
    .select("id, trigger_type, commission_amount, calculated_at, source_transaction_type, source_transaction_id")
    .eq("payout_run_id", payslip.payout_run_id)
    .eq("analyst_id", payslip.analyst_id);

  return {
    id: payslip.id,
    payout_run_id: payslip.payout_run_id,
    period_start: run?.period_start ?? "",
    period_end: run?.period_end ?? "",
    gross_amount: Number(payslip.gross_amount),
    analyst_id: payslip.analyst_id,
    analyst_name: identity?.full_name ?? "—",
    line_items: await buildLineItems(admin, records ?? []),
  };
}

export interface IntroducerStatementRow {
  id: string;
  payout_run_id: string;
  period_start: string;
  period_end: string;
  gross_amount: number;
}

export async function listIntroducerStatements(introducerId: string): Promise<IntroducerStatementRow[]> {
  const admin = createAdminClient();
  const { data: statements } = await admin
    .from("introducer_commission_statements")
    .select("id, payout_run_id, gross_amount")
    .eq("introducer_id", introducerId)
    .order("created_at", { ascending: false });
  if (!statements || statements.length === 0) return [];

  const runIds = statements.map((s) => s.payout_run_id);
  const { data: runs } = await admin.from("commission_payout_runs").select("id, period_start, period_end").in("id", runIds);
  const runById = new Map((runs ?? []).map((r) => [r.id, r]));

  return statements.map((s) => {
    const run = runById.get(s.payout_run_id);
    return {
      id: s.id,
      payout_run_id: s.payout_run_id,
      period_start: run?.period_start ?? "",
      period_end: run?.period_end ?? "",
      gross_amount: Number(s.gross_amount),
    };
  });
}

export interface IntroducerStatementDetail extends IntroducerStatementRow {
  introducer_id: string;
  introducer_name: string;
  line_items: CommissionLineItem[];
}

export async function getIntroducerStatementDetail(statementId: string): Promise<IntroducerStatementDetail | null> {
  const admin = createAdminClient();
  const { data: statement } = await admin
    .from("introducer_commission_statements")
    .select("id, payout_run_id, introducer_id, gross_amount")
    .eq("id", statementId)
    .maybeSingle();
  if (!statement) return null;

  const [{ data: run }, { data: introducer }] = await Promise.all([
    admin.from("commission_payout_runs").select("period_start, period_end").eq("id", statement.payout_run_id).maybeSingle(),
    admin.from("introducers").select("party_id").eq("id", statement.introducer_id).maybeSingle(),
  ]);
  const { data: identity } = introducer
    ? await admin.from("individuals").select("full_name").eq("party_id", introducer.party_id).maybeSingle()
    : { data: null };

  const { data: records } = await admin
    .from("commission_records")
    .select("id, trigger_type, commission_amount, calculated_at, source_transaction_type, source_transaction_id")
    .eq("payout_run_id", statement.payout_run_id)
    .eq("introducer_id", statement.introducer_id);

  return {
    id: statement.id,
    payout_run_id: statement.payout_run_id,
    period_start: run?.period_start ?? "",
    period_end: run?.period_end ?? "",
    gross_amount: Number(statement.gross_amount),
    introducer_id: statement.introducer_id,
    introducer_name: identity?.full_name ?? "—",
    line_items: await buildLineItems(admin, records ?? []),
  };
}
