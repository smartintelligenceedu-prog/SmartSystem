import { redirect } from "next/navigation";
import Link from "next/link";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole, hasAnyRole } from "@/lib/auth/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listAllCommissions, listApprovedAnalystOptions } from "./data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdjustCommissionCell } from "./adjust-commission-cell";
import { ApproveCommissionButton } from "./approve-commission-button";
import { DeleteCommissionButton } from "./delete-commission-button";
import { ReassignCommissionControl } from "./reassign-commission-control";
import { t, type TranslationKey } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

const TRIGGER_KEY = {
  personal_sale: "payroll.trigger_type.personal_sale",
  pic_channel: "payroll.trigger_type.pic_channel",
  introducer: "payroll.trigger_type.introducer",
  recruitment: "payroll.trigger_type.recruitment",
  voucher_resale: "payroll.trigger_type.voucher_resale",
  report_override: "payroll.trigger_type.report_override",
  analyst_report_fee: "payroll.trigger_type.analyst_report_fee",
} satisfies Record<string, TranslationKey>;

const STATUS_KEY = {
  pending: "commission.status.pending",
  approved: "commission.status.approved",
  paid: "commission.status.paid",
  reversed: "commission.status.reversed",
} satisfies Record<string, TranslationKey>;

async function resolveLabelMap(key: Record<string, TranslationKey>): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(Object.entries(key).map(async ([k, tk]) => [k, await t(tk)])));
}

interface SelfCommissionRow {
  id: string;
  trigger_type: string;
  calculation_type: string;
  rate_applied: number | null;
  base_amount: number;
  commission_amount: number;
  original_amount: number | null;
  status: string;
  calculated_at: string;
  adjustment_reason: string | null;
}

export default async function CommissionPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");

  const isBackOffice = isBackOfficeRole(context);
  const canSelfView = !!context.analystId || !!context.introducerId;
  if (!isBackOffice && !canSelfView) redirect("/admin");

  if (isBackOffice) {
    const [rows, analystOptions] = await Promise.all([listAllCommissions(), listApprovedAnalystOptions()]);
    const triggerLabelByType = await resolveLabelMap(TRIGGER_KEY);
    const statusLabelByStatus = await resolveLabelMap(STATUS_KEY);
    const introducerLabel = await t("commission.page.payee_type.introducer");
    const analystLabel = await t("commission.page.payee_type.analyst");
    const customerPrefix = await t("commission.page.customer_prefix");
    const priorSettlementPrefix = await t("commission.cell.prior_settlement_prefix");
    const priorSettlementSuffix = await t("commission.cell.prior_settlement_suffix");
    const flatAmountLabel = await t("commission.page.flat_amount");
    const originalAmountPrefix = await t("commission.page.original_amount_prefix");
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{await t("commission.page.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {await t("commission.page.subtitle_prefix")}
              {rows.length}
              {await t("commission.page.subtitle_suffix")}
            </p>
          </div>
          {hasAnyRole(context, ["admin", "finance"]) && (
            <Button size="sm" variant="outline" render={<Link href="/admin/commission/rules">{await t("commission.page.rules_link")}</Link>} />
          )}
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{await t("commission.page.column.date")}</TableHead>
                <TableHead>{await t("commission.page.column.payee")}</TableHead>
                <TableHead>{await t("commission.page.column.type")}</TableHead>
                <TableHead>{await t("commission.page.column.calc_method")}</TableHead>
                <TableHead>{await t("commission.page.column.amount")}</TableHead>
                <TableHead>{await t("commission.page.column.status")}</TableHead>
                <TableHead>{await t("commission.page.column.adjust")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {await t("commission.page.empty")}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {new Date(r.calculated_at).toLocaleDateString("zh-CN")}
                  </TableCell>
                  <TableCell>
                    {r.payee_name}
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({r.payee_type === "introducer" ? introducerLabel : analystLabel})
                    </span>
                    {r.customer_name && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {customerPrefix}
                        {r.customer_name}
                        {r.customer_phone_masked && ` ${r.customer_phone_masked}`}
                        {r.prior_settlement_date && (
                          <span className="ml-1 text-amber-600">
                            {priorSettlementPrefix}
                            {new Date(r.prior_settlement_date).toLocaleDateString("zh-CN")}
                            {priorSettlementSuffix}
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{triggerLabelByType[r.trigger_type] ?? r.trigger_type}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.calculation_type === "flat" ? flatAmountLabel : `${r.rate_applied}%`}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatMYR(r.commission_amount)}
                    {r.original_amount !== null && (
                      <div className="text-xs text-muted-foreground">
                        {originalAmountPrefix}
                        {formatMYR(r.original_amount)}
                      </div>
                    )}
                    {r.adjustment_reason && <div className="text-xs text-muted-foreground">{r.adjustment_reason}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.status === "paid" ? "secondary" : "outline"}>{statusLabelByStatus[r.status] ?? r.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-start gap-2">
                      {r.status === "pending" && <ApproveCommissionButton recordId={r.id} />}
                      <AdjustCommissionCell
                        recordId={r.id}
                        currentAmount={r.commission_amount}
                        customerName={r.customer_name}
                        customerPhoneMasked={r.customer_phone_masked}
                        priorSettlementDate={r.prior_settlement_date}
                      />
                      {r.payee_type === "analyst" && (
                        <ReassignCommissionControl recordId={r.id} currentAnalystId={r.analyst_id} analystOptions={analystOptions} />
                      )}
                      <DeleteCommissionButton recordId={r.id} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  // Self-view: plain RLS-scoped read (analyst_id = current_analyst_id() or
  // introducer_id = current_introducer_id() — see commission_records policy
  // in rls_policies.sql), same as every other self-scope query in this app.
  const supabase = await createServerSupabaseClient();
  const query = supabase
    .from("commission_records")
    .select("id, trigger_type, calculation_type, rate_applied, base_amount, commission_amount, original_amount, status, calculated_at, adjustment_reason")
    .order("calculated_at", { ascending: false })
    .limit(100);
  const { data } = context.analystId
    ? await query.eq("analyst_id", context.analystId)
    : await query.eq("introducer_id", context.introducerId as string);
  const rows = (data ?? []) as SelfCommissionRow[];

  const total = rows.reduce((sum, r) => sum + r.commission_amount, 0);
  const selfTriggerLabelByType = await resolveLabelMap(TRIGGER_KEY);
  const selfStatusLabelByStatus = await resolveLabelMap(STATUS_KEY);
  const selfFlatAmountLabel = await t("commission.page.flat_amount");
  const adjustedPrefix = await t("commission.page.adjusted_prefix");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{await t("commission.page.self_title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {await t("commission.page.self_subtitle_prefix")}
          {rows.length}
          {await t("commission.page.self_subtitle_middle")}
          {formatMYR(total)}
        </p>
      </div>
      <div className="divide-y rounded-md border">
        {rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">{await t("commission.page.self_empty")}</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <div>
              <p>{selfTriggerLabelByType[r.trigger_type] ?? r.trigger_type}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(r.calculated_at).toLocaleDateString("zh-CN")} ·{" "}
                {r.calculation_type === "flat" ? selfFlatAmountLabel : `${r.rate_applied}% of ${formatMYR(r.base_amount)}`}
              </p>
              {r.adjustment_reason && (
                <p className="text-xs text-muted-foreground">
                  {adjustedPrefix}
                  {r.adjustment_reason}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="tabular-nums">{formatMYR(r.commission_amount)}</span>
              <Badge variant={r.status === "paid" ? "secondary" : "outline"}>{selfStatusLabelByStatus[r.status] ?? r.status}</Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
