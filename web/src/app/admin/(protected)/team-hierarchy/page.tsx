import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { loadAnalystHierarchy, type HierarchyNode, type HierarchyAnomaly } from "./data";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { t, type TranslationKey } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const STATUS_KEY = {
  pending: "dashboard.agent.status.pending",
  approved: "dashboard.agent.status.approved",
  suspended: "dashboard.agent.status.suspended",
  rejected: "dashboard.agent.status.rejected",
  terminated: "dashboard.agent.status.terminated",
} satisfies Record<string, TranslationKey>;

function TreeNode({
  node,
  depth,
  statusLabel,
  sponsorPrefix,
}: {
  node: HierarchyNode;
  depth: number;
  statusLabel: Record<string, string>;
  sponsorPrefix: string;
}) {
  return (
    <div className={depth > 0 ? "ml-5 border-l border-slate-200 pl-4" : ""}>
      <div className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
        <span className="font-medium">{node.full_name}</span>
        <Badge variant={node.status === "approved" ? "secondary" : "outline"}>{statusLabel[node.status] ?? node.status}</Badge>
        {node.sponsor_name && (
          <span className="text-xs text-muted-foreground">
            {sponsorPrefix}
            {node.sponsor_name}
          </span>
        )}
      </div>
      {node.children.map((child) => (
        <TreeNode key={child.analyst_id} node={child} depth={depth + 1} statusLabel={statusLabel} sponsorPrefix={sponsorPrefix} />
      ))}
    </div>
  );
}

function formatAnomaly(a: HierarchyAnomaly, text: Record<string, string>, statusLabel: Record<string, string>): string {
  switch (a.kind) {
    case "self_sponsor":
      return text.self_sponsor.replace("{name}", a.full_name);
    case "self_leader":
      return text.self_leader.replace("{name}", a.full_name);
    case "cycle":
      return text.cycle.replace("{name}", a.full_name);
    case "sponsor_leader_mismatch":
      return text.sponsor_leader_mismatch.replace("{name}", a.full_name).replace("{sponsor}", a.sponsor_name).replace("{leader}", a.leader_name);
    case "leader_inactive":
      return text.leader_inactive
        .replace("{name}", a.full_name)
        .replace("{leader}", a.leader_name)
        .replace("{status}", statusLabel[a.leader_status] ?? a.leader_status);
  }
}

export default async function TeamHierarchyPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!isBackOfficeRole(context)) redirect("/admin");

  const { roots, orphaned, anomalies } = await loadAnalystHierarchy();

  const statusLabel = Object.fromEntries(
    await Promise.all(Object.entries(STATUS_KEY).map(async ([k, key]) => [k, await t(key)]))
  ) as Record<string, string>;

  const [
    title,
    subtitle,
    sponsorPrefix,
    treeTitle,
    treeEmpty,
    anomalyTitle,
    anomalyEmpty,
    orphanTitle,
    selfSponsor,
    selfLeader,
    cycle,
    sponsorLeaderMismatch,
    leaderInactive,
  ] = await Promise.all([
    t("team_hierarchy.page.title"),
    t("team_hierarchy.page.subtitle"),
    t("team_hierarchy.sponsor_prefix"),
    t("team_hierarchy.tree.title"),
    t("team_hierarchy.tree.empty"),
    t("team_hierarchy.anomaly.title"),
    t("team_hierarchy.anomaly.empty"),
    t("team_hierarchy.orphan.title"),
    t("team_hierarchy.anomaly.self_sponsor"),
    t("team_hierarchy.anomaly.self_leader"),
    t("team_hierarchy.anomaly.cycle"),
    t("team_hierarchy.anomaly.sponsor_leader_mismatch"),
    t("team_hierarchy.anomaly.leader_inactive"),
  ]);
  const anomalyText = {
    self_sponsor: selfSponsor,
    self_leader: selfLeader,
    cycle,
    sponsor_leader_mismatch: sponsorLeaderMismatch,
    leader_inactive: leaderInactive,
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{anomalyTitle}</h2>
        <Card>
          <CardContent className="pt-6">
            {anomalies.length === 0 ? (
              <p className="text-sm text-muted-foreground">{anomalyEmpty}</p>
            ) : (
              <ul className="list-disc space-y-1.5 pl-4 text-sm">
                {anomalies.map((a, i) => (
                  <li key={`${a.analyst_id}-${a.kind}-${i}`}>{formatAnomaly(a, anomalyText, statusLabel)}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{treeTitle}</h2>
        <Card>
          <CardContent className="pt-6">
            {roots.length === 0 ? (
              <p className="text-sm text-muted-foreground">{treeEmpty}</p>
            ) : (
              roots.map((node) => (
                <TreeNode key={node.analyst_id} node={node} depth={0} statusLabel={statusLabel} sponsorPrefix={sponsorPrefix} />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {orphaned.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{orphanTitle}</h2>
          <Card>
            <CardContent className="pt-6">
              {orphaned.map((node) => (
                <TreeNode key={node.analyst_id} node={node} depth={0} statusLabel={statusLabel} sponsorPrefix={sponsorPrefix} />
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
