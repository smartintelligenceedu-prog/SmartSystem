import { redirect } from "next/navigation";
import Link from "next/link";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listSalesOrders } from "./data";
import { Button } from "@/components/ui/button";
import { SalesOrdersSearch } from "./sales-orders-search";

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
          <h1 className="text-xl font-semibold">销售订单</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {status === "pending" ? "待审核付款的订单" : isBackOffice ? "全公司检测服务订单" : "你的检测服务订单"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isBackOffice && <Button size="sm" variant="outline" render={<Link href="/admin/sales-orders/items">销售项目 / 价目表</Link>} />}
          {context.analystId && <Button size="sm" render={<Link href="/admin/sales-orders/new">新增销售订单</Link>} />}
        </div>
      </div>

      <SalesOrdersSearch orders={orders} isBackOffice={isBackOffice} />
    </div>
  );
}
