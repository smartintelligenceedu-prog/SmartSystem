import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AnalystStatus } from "@/lib/types/registration";

export interface HierarchyNode {
  analyst_id: string;
  full_name: string;
  status: AnalystStatus;
  sponsor_name: string | null;
  children: HierarchyNode[];
}

export type HierarchyAnomaly =
  | { kind: "self_sponsor"; analyst_id: string; full_name: string }
  | { kind: "self_leader"; analyst_id: string; full_name: string }
  | { kind: "cycle"; analyst_id: string; full_name: string }
  | { kind: "sponsor_leader_mismatch"; analyst_id: string; full_name: string; sponsor_name: string; leader_name: string }
  | { kind: "leader_inactive"; analyst_id: string; full_name: string; leader_name: string; leader_status: AnalystStatus };

export interface HierarchyResult {
  roots: HierarchyNode[];
  // Left out of `roots` on purpose — a node stuck in an assigned_leader_id
  // cycle (A's leader chain loops back to A) has no well-defined depth, so it
  // can't be placed in a tree. Surfaced separately instead of silently
  // dropped, since a cycle can only come from a data-entry mistake.
  orphaned: HierarchyNode[];
  anomalies: HierarchyAnomaly[];
}

// Company-wide audit view for back office: analysts.sponsor_id (the
// recruiter/commission chain) and analysts.assigned_leader_id (the
// operational team assignment that also drives the RM40 report_override
// commission — see migration 015) are two independent parent pointers that
// can legitimately differ, but silently diverging is exactly the kind of
// mistake this page exists to surface. The tree itself is built off
// assigned_leader_id, since that's the "downline" concept every other
// Leader-facing screen (team_summary/team_members RPCs, the Leader dashboard
// section) already uses.
export async function loadAnalystHierarchy(): Promise<HierarchyResult> {
  const admin = createAdminClient();
  const { data: analysts } = await admin
    .from("analysts")
    .select("id, party_id, status, sponsor_id, assigned_leader_id")
    .order("created_at", { ascending: true });
  const rows = analysts ?? [];

  const partyIds = rows.map((a) => a.party_id);
  const { data: identities } =
    partyIds.length > 0 ? await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds) : { data: [] };
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));

  const byId = new Map(rows.map((a) => [a.id, a]));
  const nameById = new Map(rows.map((a) => [a.id, nameByParty.get(a.party_id) ?? "—"]));

  const anomalies: HierarchyAnomaly[] = [];
  for (const a of rows) {
    const fullName = nameById.get(a.id) ?? "—";
    if (a.sponsor_id === a.id) anomalies.push({ kind: "self_sponsor", analyst_id: a.id, full_name: fullName });
    if (a.assigned_leader_id === a.id) anomalies.push({ kind: "self_leader", analyst_id: a.id, full_name: fullName });
    if (a.sponsor_id && a.assigned_leader_id && a.sponsor_id !== a.assigned_leader_id) {
      anomalies.push({
        kind: "sponsor_leader_mismatch",
        analyst_id: a.id,
        full_name: fullName,
        sponsor_name: nameById.get(a.sponsor_id) ?? "—",
        leader_name: nameById.get(a.assigned_leader_id) ?? "—",
      });
    }
    if (a.assigned_leader_id && a.assigned_leader_id !== a.id) {
      const leader = byId.get(a.assigned_leader_id);
      if (leader && leader.status !== "approved") {
        anomalies.push({
          kind: "leader_inactive",
          analyst_id: a.id,
          full_name: fullName,
          leader_name: nameById.get(a.assigned_leader_id) ?? "—",
          leader_status: leader.status as AnalystStatus,
        });
      }
    }
  }

  const childrenOf = new Map<string, string[]>();
  for (const a of rows) {
    if (a.assigned_leader_id && a.assigned_leader_id !== a.id && byId.has(a.assigned_leader_id)) {
      const arr = childrenOf.get(a.assigned_leader_id) ?? [];
      arr.push(a.id);
      childrenOf.set(a.assigned_leader_id, arr);
    }
  }

  function toNode(id: string): HierarchyNode {
    const a = byId.get(id)!;
    return {
      analyst_id: id,
      full_name: nameById.get(id) ?? "—",
      status: a.status as AnalystStatus,
      sponsor_name: a.sponsor_id ? (nameById.get(a.sponsor_id) ?? "—") : null,
      children: [],
    };
  }

  const visited = new Set<string>();
  function buildNode(id: string, ancestry: Set<string>): HierarchyNode | null {
    if (ancestry.has(id)) return null;
    visited.add(id);
    const node = toNode(id);
    const nextAncestry = new Set(ancestry).add(id);
    node.children = (childrenOf.get(id) ?? [])
      .map((childId) => buildNode(childId, nextAncestry))
      .filter((n): n is HierarchyNode => n !== null);
    return node;
  }

  const rootIds = rows
    .filter((a) => !a.assigned_leader_id || a.assigned_leader_id === a.id || !byId.has(a.assigned_leader_id))
    .map((a) => a.id);
  const roots = rootIds.map((id) => buildNode(id, new Set())).filter((n): n is HierarchyNode => n !== null);

  // Anyone left unvisited is part of an assigned_leader_id cycle with no
  // reachable root — whether the cycle is only discovered mid-walk (a node
  // revisited inside its own ancestry chain) or never touched by any root's
  // walk at all, both cases land here, so every affected analyst gets
  // exactly one "cycle" anomaly instead of only the ones a root happened to
  // reach first.
  const orphaned = rows.filter((a) => !visited.has(a.id)).map((a) => toNode(a.id));
  for (const node of orphaned) anomalies.push({ kind: "cycle", analyst_id: node.analyst_id, full_name: node.full_name });

  return { roots, orphaned, anomalies };
}
