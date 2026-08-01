import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasAnyRole, hasRole } from "@/lib/auth/roles";
import { listInstitutionalOrders, listInstitutionOptions, listPackages, listActivePackageOptions, type InstitutionalOrderState } from "./data";
import { listApprovedAgents, listOwnCustomersForPicker } from "../../sales-orders/data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OrderActionsCell } from "./order-actions-cell";
import { CreateInstitutionalOrderForm } from "./create-institutional-order-form";
import { CreatePackageForm } from "./create-package-form";
import { EditPackageCommissionCell } from "./edit-package-commission-cell";
import { VoucherProgressBar } from "./voucher-progress-bar";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

const STATE_KEY: Record<InstitutionalOrderState, Parameters<typeof t>[0]> = {
  no_invoice: "finance.institutional.state.no_invoice",
  invoiced_awaiting_payment: "finance.institutional.state.invoiced_awaiting_payment",
  deposit_received_awaiting_settlement: "finance.institutional.state.deposit_received_awaiting_settlement",
  settled_awaiting_final_payment: "finance.institutional.state.settled_awaiting_final_payment",
  fully_paid: "finance.institutional.state.fully_paid",
  closed: "finance.institutional.state.closed",
};

const STATE_BADGE_VARIANT: Record<InstitutionalOrderState, "secondary" | "outline"> = {
  no_invoice: "outline",
  invoiced_awaiting_payment: "outline",
  deposit_received_awaiting_settlement: "outline",
  settled_awaiting_final_payment: "outline",
  fully_paid: "secondary",
  closed: "outline",
};

export default async function InstitutionalOrdersPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");

  const canManage = hasAnyRole(context, ["admin", "finance"]);
  // Institutional/B2B order handling is a PIC-only capability, not a
  // general analyst one — every analyst used to get isAgentViewer just for
  // having an analyst profile at all, showing this page (and its sidebar
  // link) to plain agents who have nothing to do with institutional deals.
  const isAgentViewer = !canManage && !!context.analystId && hasRole(context, "pic");
  if (!canManage && !isAgentViewer) redirect("/admin");

  const [orders, agents, institutions, packages, activePackageOptions, customers] = await Promise.all([
    listInstitutionalOrders(isAgentViewer ? context.analystId! : undefined),
    // includeAll: true — this list is only ever fetched for canManage
    // (admin/finance) viewers, who should see every agent, not just their
    // own downline. analystId is unused in that branch.
    canManage ? listApprovedAgents(context.analystId ?? "", true) : Promise.resolve([]),
    canManage ? listInstitutionOptions() : Promise.resolve([]),
    canManage ? listPackages() : Promise.resolve([]),
    canManage ? listActivePackageOptions() : Promise.resolve([]),
    // includeAll: true — back office billing an individual customer's
    // deposit/invoice isn't scoped to one analyst's own downline, same
    // reasoning as the agents list above.
    canManage ? listOwnCustomersForPicker("", true) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{canManage ? t("finance.institutional.title") : t("finance.institutional.nav.agent_label")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("finance.institutional.subtitle")}</p>
        </div>
        {canManage && (
          <Button size="sm" variant="secondary" render={<Link href="/admin/finance/institutional/redeem">{t("finance.institutional.voucher.redeem_nav_link")}</Link>} />
        )}
      </div>

      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("finance.institutional.column.description")}</TableHead>
              <TableHead>{t("finance.institutional.column.billed_to")}</TableHead>
              <TableHead>{t("finance.institutional.column.amount")}</TableHead>
              <TableHead>{t("finance.institutional.column.analyst")}</TableHead>
              <TableHead>{t("finance.institutional.column.invoice_no")}</TableHead>
              <TableHead>{t("finance.institutional.column.ar_balance")}</TableHead>
              <TableHead>{t("finance.institutional.voucher.column_label")}</TableHead>
              <TableHead>{t("finance.institutional.column.state")}</TableHead>
              <TableHead>{t("finance.institutional.column.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  {t("finance.institutional.empty")}
                </TableCell>
              </TableRow>
            )}
            {orders.map((o) => (
              <TableRow key={o.order_id} id={`order-${o.order_id}`}>
                <TableCell>
                  {o.description}
                  {o.package_name && <div className="text-xs text-muted-foreground">{o.package_name}</div>}
                </TableCell>
                <TableCell className="text-muted-foreground">{o.billed_to_name}</TableCell>
                <TableCell className="tabular-nums">{formatMYR(o.total_amount)}</TableCell>
                <TableCell className="text-muted-foreground">{o.analyst_name ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{o.invoice_no ?? "—"}</TableCell>
                <TableCell className="tabular-nums">
                  {o.ar_balance > 0 ? formatMYR(o.ar_balance) : "—"}
                  {o.package_deposit_applied > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {t("finance.institutional.column.deposit_applied_prefix")}
                      {formatMYR(o.package_deposit_applied)}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <VoucherProgressBar total={o.voucher_total} used={o.voucher_used} />
                </TableCell>
                <TableCell>
                  <Badge variant={STATE_BADGE_VARIANT[o.state]}>{t(STATE_KEY[o.state])}</Badge>
                  {canManage && o.invoice_requested_at && (
                    <Badge variant="outline" className="ml-1">
                      {t("finance.institutional.state.invoice_requested_badge")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <OrderActionsCell row={o} canManage={canManage} agents={agents} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {canManage && (
        <div>
          <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("finance.institutional.package.section_title")}</h2>
          <div className="mb-4 overflow-x-auto rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("finance.institutional.package.column.institution")}</TableHead>
                  <TableHead>{t("finance.institutional.package.column.name")}</TableHead>
                  <TableHead>{t("finance.institutional.package.column.progress")}</TableHead>
                  <TableHead>{t("finance.institutional.package.column.unit_price")}</TableHead>
                  <TableHead>{t("finance.institutional.package.column.deposit")}</TableHead>
                  <TableHead>{t("finance.institutional.package.column.responsible")}</TableHead>
                  <TableHead>{t("finance.institutional.package.column.commission")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packages.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                      {t("finance.institutional.package.empty")}
                    </TableCell>
                  </TableRow>
                )}
                {packages.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.institution_name}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>
                      <VoucherProgressBar total={p.total_credits} used={p.used_credits} />
                    </TableCell>
                    <TableCell className="tabular-nums">{formatMYR(p.unit_price)}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {p.deposit_amount !== null ? (
                        <div>
                          <div>{formatMYR(p.deposit_amount)}</div>
                          {p.deposit_received_at ? (
                            <Badge variant="secondary" className="mt-1">
                              {t("finance.institutional.package.deposit_received_badge")}
                            </Badge>
                          ) : p.deposit_order_id ? (
                            <a href={`#order-${p.deposit_order_id}`} className="text-xs text-primary underline">
                              {t("finance.institutional.package.deposit_pending_link")}
                            </a>
                          ) : (
                            <Badge variant="outline" className="mt-1">
                              {t("finance.institutional.package.deposit_pending_badge")}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.responsible_analyst_name ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      <EditPackageCommissionCell pkg={p} agents={agents} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <CreatePackageForm institutions={institutions} agents={agents} />
        </div>
      )}

      {canManage && (
        <div>
          <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("finance.institutional.new_order.title")}</h2>
          <CreateInstitutionalOrderForm agents={agents} institutions={institutions} packages={activePackageOptions} customers={customers} />
        </div>
      )}
    </div>
  );
}
