import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { ComingSoon } from "../_components/coming-soon";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!context.analystId) redirect("/admin");

  return (
    <ComingSoon
      title="我的报告"
      description="脑波检测报告存取记录。"
      note="系统目前不存放报告本身，只记录检测服务已发生（计费/佣金触发点）。报告存取功能需要先决定报告存放在哪个系统，留待未来阶段规划。"
    />
  );
}
