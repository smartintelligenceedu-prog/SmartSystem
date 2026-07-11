import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasRole } from "@/lib/auth/roles";
import { ComingSoon } from "../_components/coming-soon";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!hasRole(context, "admin")) redirect("/admin");

  return <ComingSoon title="设定" description="系统层级设定。" />;
}
