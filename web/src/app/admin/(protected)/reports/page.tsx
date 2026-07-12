import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listReportableOrders } from "./data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MarkDeliveredButton } from "./mark-delivered-button";

export const dynamic = "force-dynamic";

const ITEM_TYPE_LABEL: Record<string, string> = {
  detection_session: "检测服务（现场付款）",
  voucher_redemption: "检测券兑换",
};

export default async function ReportsPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  const isBackOffice = isBackOfficeRole(context);
  if (!context.analystId && !isBackOffice) redirect("/admin");

  const orders = await listReportableOrders(isBackOffice);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{isBackOffice ? "报告交付状态" : "我的报告"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          系统不存放报告本身（检测设备自己产报告，交付走 WhatsApp/邮件），这里只记录是否已经交给顾客。
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日期</TableHead>
              <TableHead>顾客</TableHead>
              {isBackOffice && <TableHead>分析师</TableHead>}
              <TableHead>类型</TableHead>
              <TableHead>状态</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={isBackOffice ? 6 : 5} className="text-center text-muted-foreground">
                  尚无检测服务订单
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
                <TableCell>
                  {o.report_delivered_at ? (
                    <Badge variant="secondary">
                      已交付 · {new Date(o.report_delivered_at).toLocaleDateString("zh-CN")}
                    </Badge>
                  ) : (
                    <Badge variant="outline">未交付</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {!o.report_delivered_at && <MarkDeliveredButton orderId={o.order_id} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
