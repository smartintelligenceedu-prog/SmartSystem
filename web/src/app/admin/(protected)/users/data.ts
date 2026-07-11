import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PortalRole } from "@/lib/auth/roles";

const BACK_OFFICE_ROLES: PortalRole[] = ["admin", "finance", "back_office"];

export interface BackOfficeUserRow {
  user_id: string;
  full_name: string;
  email: string;
  roles: PortalRole[];
}

/**
 * Scoped to admin/finance/back_office roles only — Agent/Leader/Introducer/PIC
 * accounts are managed on their own pages (the analyst detail page and
 * /admin/introducers), not here, so this list doesn't get cluttered with
 * every field-role account once Phase 3 starts creating a lot of them.
 */
export async function listBackOfficeUsers(): Promise<BackOfficeUserRow[]> {
  const admin = createAdminClient();

  const { data: users } = await admin.from("users").select("id, party_id");
  if (!users || users.length === 0) return [];

  const partyIds = users.map((u) => u.party_id);
  const { data: identities } = await admin.from("individuals").select("party_id, full_name, email").in("party_id", partyIds);
  const identityByParty = new Map((identities ?? []).map((i) => [i.party_id, i]));

  const { data: userRoles } = await admin
    .from("user_roles")
    .select("user_id, roles(name)")
    .in("user_id", users.map((u) => u.id));

  const rolesByUser = new Map<string, PortalRole[]>();
  for (const row of userRoles ?? []) {
    const roleName = (row.roles as unknown as { name: PortalRole } | null)?.name;
    if (!roleName) continue;
    const list = rolesByUser.get(row.user_id) ?? [];
    list.push(roleName);
    rolesByUser.set(row.user_id, list);
  }

  return users
    .map((u) => ({
      user_id: u.id,
      full_name: identityByParty.get(u.party_id)?.full_name ?? "—",
      email: identityByParty.get(u.party_id)?.email ?? "—",
      roles: rolesByUser.get(u.id) ?? [],
    }))
    .filter((u) => u.roles.some((r) => BACK_OFFICE_ROLES.includes(r)));
}
