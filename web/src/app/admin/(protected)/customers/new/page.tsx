import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { ComingSoon } from "../../_components/coming-soon";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!context.analystId) redirect("/admin");

  return (
    <ComingSoon
      title="登记新顾客"
      description="为你名下新增一位顾客。"
      note="此表单会在未来阶段开发，需要独立的规格讨论。"
    />
  );
}
