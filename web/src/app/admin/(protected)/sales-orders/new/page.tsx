import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { listOwnCustomersForPicker, listOwnRedeemableVouchers } from "../data";
import { NewSalesOrderForm } from "./new-sales-order-form";

export const dynamic = "force-dynamic";

export default async function NewSalesOrderPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!context.analystId) redirect("/admin");

  const [customers, vouchers] = await Promise.all([
    listOwnCustomersForPicker(context.analystId),
    listOwnRedeemableVouchers(context.analystId),
  ]);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-semibold">新增销售订单</h1>
        <p className="mt-1 text-sm text-muted-foreground">为顾客建立一笔检测服务订单。</p>
      </div>
      <NewSalesOrderForm customers={customers} vouchers={vouchers} />
    </div>
  );
}
