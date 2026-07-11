import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { ComingSoon } from "../../_components/coming-soon";

export const dynamic = "force-dynamic";

export default async function NewSalesOrderPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!context.analystId) redirect("/admin");

  return (
    <ComingSoon
      title="新增销售订单"
      description="为顾客建立一笔检测服务订单。"
      note="此表单会在未来阶段开发，需要独立的规格讨论。"
    />
  );
}
