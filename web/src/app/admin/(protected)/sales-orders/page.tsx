import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { ComingSoon } from "../_components/coming-soon";

export const dynamic = "force-dynamic";

export default async function SalesOrdersPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!context.analystId && !isBackOfficeRole(context)) redirect("/admin");

  return (
    <ComingSoon
      title="销售订单"
      description="检测服务订单列表与状态。"
      note="完整的订单管理功能会在未来阶段开发，需要独立的规格讨论。"
    />
  );
}
