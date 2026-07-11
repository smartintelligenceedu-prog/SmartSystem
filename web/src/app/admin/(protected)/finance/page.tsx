import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasAnyRole } from "@/lib/auth/roles";
import { ComingSoon } from "../_components/coming-soon";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!hasAnyRole(context, ["admin", "finance"])) redirect("/admin");

  return (
    <ComingSoon
      title="财务"
      description="总帐、支出与损益记录。"
      note="正式总帐（Chart of Accounts）与损益表还没有开发；Admin Dashboard 上的 Net Profit 目前只是「Monthly Sales − 佣金支出」的简化估算。"
    />
  );
}
