import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type BackOfficeRole = "admin" | "finance" | "back_office";

export interface PortalUserContext {
  userId: string;
  authUserId: string;
  partyId: string;
  fullName: string;
  email: string;
  roles: BackOfficeRole[];
}

/**
 * Role Detection: resolves the logged-in Supabase Auth user to their internal
 * identity + role list. Returns null if there's no session — callers decide
 * whether that means redirect (pages) or a 401-style error (actions).
 *
 * This is a convenience read, not the authorization boundary — every
 * privileged Server Action still calls is_back_office() (or a specific role
 * check) against the caller's own session independently. See the same note
 * in admin/registrations/actions.ts.
 */
export async function getPortalUserContext(): Promise<PortalUserContext | null> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const { data: userRow } = await supabase
    .from("users")
    .select("id, party_id")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();
  if (!userRow) return null;

  const { data: identity } = await supabase
    .from("individuals")
    .select("full_name, email")
    .eq("party_id", userRow.party_id)
    .maybeSingle();

  // user_roles -> roles IS a direct foreign key (role_id references roles.id),
  // unlike the analysts <-> individuals case elsewhere in this codebase, so a
  // single embedded select is safe here.
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userRow.id);

  const roles = (roleRows ?? [])
    .map((r) => (r.roles as unknown as { name: string } | null)?.name)
    .filter((name): name is BackOfficeRole => !!name);

  return {
    userId: userRow.id,
    authUserId: authUser.id,
    partyId: userRow.party_id,
    fullName: identity?.full_name ?? "—",
    email: identity?.email ?? authUser.email ?? "—",
    roles,
  };
}

export function hasRole(context: PortalUserContext | null, role: BackOfficeRole): boolean {
  return context?.roles.includes(role) ?? false;
}
