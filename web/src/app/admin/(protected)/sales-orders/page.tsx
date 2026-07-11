import { redirect } from "next/navigation";
import Link from "next/link";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listSalesOrders } from "./data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  paid: "已付款",
  cancelled: "已取消",
  refunded: "已退款",
};

const ITEM_TYPE_LABEL: Record<string, string> = {
  detection_session: "检测服务（现场付款）",
  voucher_redemption: "检测券兑换",
};

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
        {context.analystId && <Button size="sm" render={<Link href="/admin/sales-orders/new">新增销售订单</Link>} />}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日期</TableHead>
              <TableHead>顾客</TableHead>
              {isBackOffice && <TableHead>分析师</TableHead>}
              <TableHead>类型</TableHead>
              <TableHead>金额</TableHead>
              <TableHead>状态</TableHead>
              {isBackOffice && <TableHead></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={isBackOffice ? 7 : 5} className="text-center text-muted-foreground">
                  尚无订单
                </TableCell>
              </TableRow>
            )}
            {orders.map((o) => (
              <TableRow key={o.order_id}>
                <TableCell className="text-muted-foreground tabular-nums">
                  {new Date(o.created_at).toLocaleDateString("zh-CN")}
                </TableCell>
                <TableCell>{o.customer_name}</TableCell>
                {isBackOffice && <TableCell className="text-muted-foreground">{o.analyst_name}</TableCell>}
                <TableCell className="text-muted-foreground">{ITEM_TYPE_LABEL[o.item_type] ?? o.item_type}</TableCell>
                <TableCell className="tabular-nums">{formatMYR(o.total_amount)}</TableCell>
                <TableCell>
                  <Badge variant={o.order_status === "paid" ? "secondary" : "outline"}>
                    {ORDER_STATUS_LABEL[o.order_status] ?? o.order_status}
                  </Badge>
                </TableCell>
                {isBackOffice && (
                  <TableCell>
                    {o.review_status === "pending" && (
                      <Button size="sm" variant="outline" render={<Link href={`/admin/sales-orders/${o.order_id}`}>审核</Link>} />
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
