import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BackOfficeRole } from "@/lib/auth/context";

export interface BackOfficeUserRow {
  user_id: string;
  full_name: string;
  email: string;
  roles: BackOfficeRole[];
}

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

  const rolesByUser = new Map<string, BackOfficeRole[]>();
  for (const row of userRoles ?? []) {
    const roleName = (row.roles as unknown as { name: BackOfficeRole } | null)?.name;
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
    .filter((u) => u.roles.length > 0); // only show actual back-office staff, not every `users` row
}
