import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasAnyRole } from "@/lib/auth/roles";
import { listInstitutionalOrders, type InstitutionalOrderState } from "./data";
import { listApprovedAgents } from "../../sales-orders/data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { OrderActionsCell } from "./order-actions-cell";
import { CreateInstitutionalOrderForm } from "./create-institutional-order-form";
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
  if (!hasAnyRole(context, ["admin", "finance"])) redirect("/admin");

  const [orders, agents] = await Promise.all([listInstitutionalOrders(), listApprovedAgents()]);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">{t("finance.institutional.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("finance.institutional.subtitle")}</p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("finance.institutional.column.description")}</TableHead>
              <TableHead>{t("finance.institutional.column.amount")}</TableHead>
              <TableHead>{t("finance.institutional.column.analyst")}</TableHead>
              <TableHead>{t("finance.institutional.column.invoice_no")}</TableHead>
              <TableHead>{t("finance.institutional.column.ar_balance")}</TableHead>
              <TableHead>{t("finance.institutional.column.state")}</TableHead>
              <TableHead>{t("finance.institutional.column.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {t("finance.institutional.empty")}
                </TableCell>
              </TableRow>
            )}
            {orders.map((o) => (
              <TableRow key={o.order_id}>
                <TableCell>{o.description}</TableCell>
                <TableCell className="tabular-nums">{formatMYR(o.total_amount)}</TableCell>
                <TableCell className="text-muted-foreground">{o.analyst_name ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{o.invoice_no ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{o.ar_balance > 0 ? formatMYR(o.ar_balance) : "—"}</TableCell>
                <TableCell>
                  <Badge variant={STATE_BADGE_VARIANT[o.state]}>{t(STATE_KEY[o.state])}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <OrderActionsCell row={o} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("finance.institutional.new_order.title")}</h2>
        <CreateInstitutionalOrderForm agents={agents} />
      </div>
    </div>
  );
}
