import { redirect } from "next/navigation";
import Link from "next/link";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listSalesOrders } from "./data";
import { Button } from "@/components/ui/button";
import { SalesOrdersSearch } from "./sales-orders-search";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function SalesOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  const isBackOffice = isBackOfficeRole(context);
  if (!context.analystId && !isBackOffice) redirect("/admin");

  const { status } = await searchParams;
  const orders = await listSalesOrders(isBackOffice, status);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{await t("sales_orders.page.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {status === "pending"
              ? await t("sales_orders.page.subtitle_pending")
              : isBackOffice
                ? await t("sales_orders.page.subtitle_back_office")
                : await t("sales_orders.page.subtitle_own")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isBackOffice && (
            <Button size="sm" variant="outline" render={<Link href="/admin/sales-orders/items">{await t("sales_orders.page.items_link")}</Link>} />
          )}
          {context.analystId && (
            <Button size="sm" render={<Link href="/admin/sales-orders/new">{await t("sales_orders.page.new_order_link")}</Link>} />
          )}
        </div>
      </div>

      <SalesOrdersSearch orders={orders} isBackOffice={isBackOffice} />
    </div>
  );
}
