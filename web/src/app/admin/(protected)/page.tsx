import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasRole, isBackOfficeRole } from "@/lib/auth/roles";
import { AdminSection } from "./_dashboard/admin-section";
import { LeaderSection } from "./_dashboard/leader-section";
import { AgentSection } from "./_dashboard/agent-section";
import { IntroducerSection } from "./_dashboard/introducer-section";
import { PicSection } from "./_dashboard/pic-section";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// Role Detection composes the Dashboard: one section per role the logged-in
// user holds, not a role -> separate-account mapping. A Leader+Agent sees
// both sections stacked on this one page.
export default async function DashboardPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");

  const showAdmin = isBackOfficeRole(context);
  const showLeader = hasRole(context, "leader") && !!context.analystId;
  const showAgent = hasRole(context, "agent") && !!context.analystId;
  const showIntroducer = hasRole(context, "introducer") && !!context.introducerId;
  const showPic = hasRole(context, "pic") && !!context.analystId;

  const nothingToShow = !showAdmin && !showLeader && !showAgent && !showIntroducer && !showPic;

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <h1 className="text-xl font-semibold">{await t("dashboard.nav.label")}</h1>

      {nothingToShow && (
        <p className="text-sm text-muted-foreground">
          {await t("dashboard.nothing_to_show")}
        </p>
      )}

      {showAdmin && <AdminSection />}
      {showLeader && context.analystId && <LeaderSection analystId={context.analystId} />}
      {showAgent && context.analystId && <AgentSection analystId={context.analystId} />}
      {showIntroducer && context.introducerId && <IntroducerSection introducerId={context.introducerId} />}
      {showPic && context.analystId && <PicSection analystId={context.analystId} />}
    </div>
  );
}
