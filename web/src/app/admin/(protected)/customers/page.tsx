import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { ComingSoon } from "../_components/coming-soon";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!context.analystId && !isBackOfficeRole(context)) redirect("/admin");

  return (
    <ComingSoon
      title="顾客"
      description="CRM 顾客名单、归属与联络记录。"
      note="完整的顾客管理功能（新增、转移归属、互动记录）会在未来阶段开发，需要独立的规格讨论。"
    />
  );
}
