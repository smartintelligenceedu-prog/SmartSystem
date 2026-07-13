import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listReportableOrders } from "./data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MarkDeliveredButton } from "./mark-delivered-button";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const ITEM_TYPE_KEY: Record<string, Parameters<typeof t>[0]> = {
  detection_session: "reports.item_type.detection_session",
  voucher_redemption: "reports.item_type.voucher_redemption",
};

const TIER_KEY: Record<string, Parameters<typeof t>[0]> = {
  standard: "reports.tier.standard",
  upgrade: "reports.tier.upgrade",
};

export default async function ReportsPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  const isBackOffice = isBackOfficeRole(context);
  if (!context.analystId && !isBackOffice) redirect("/admin");

  const orders = await listReportableOrders(isBackOffice, context.analystId);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{isBackOffice ? t("reports.title.back_office") : t("reports.title.self")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("reports.subtitle")}</p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("reports.column.date")}</TableHead>
              <TableHead>{t("reports.column.customer")}</TableHead>
              {isBackOffice && <TableHead>{t("reports.column.analyst")}</TableHead>}
              <TableHead>{t("reports.column.type")}</TableHead>
              <TableHead>{t("reports.column.tier")}</TableHead>
              <TableHead>{t("reports.column.status")}</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={isBackOffice ? 7 : 6} className="text-center text-muted-foreground">
                  {t("reports.empty")}
                </TableCell>
              </TableRow>
            )}
            {orders.map((o) => (
              <TableRow key={o.item_id}>
                <TableCell className="text-muted-foreground tabular-nums">
                  {new Date(o.created_at).toLocaleDateString("zh-CN")}
                </TableCell>
                <TableCell>{o.customer_name}</TableCell>
                {isBackOffice && <TableCell className="text-muted-foreground">{o.analyst_name}</TableCell>}
                <TableCell className="text-muted-foreground">{t(ITEM_TYPE_KEY[o.item_type] ?? "reports.item_type.detection_session")}</TableCell>
                <TableCell className="text-muted-foreground">{o.report_tier ? t(TIER_KEY[o.report_tier]) : "—"}</TableCell>
                <TableCell>
                  {o.report_delivered_at ? (
                    <Badge variant="secondary">
                      {t("reports.status.delivered")} · {new Date(o.report_delivered_at).toLocaleDateString("zh-CN")}
                    </Badge>
                  ) : (
                    <Badge variant="outline">{t("reports.status.undelivered")}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {!o.report_delivered_at && o.can_mark_delivered && <MarkDeliveredButton orderItemId={o.item_id} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
