import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { PortalRole } from "./roles";

export type { PortalRole } from "./roles";

export interface PortalUserContext {
  userId: string;
  authUserId: string;
  partyId: string;
  fullName: string;
  email: string;
  roles: PortalRole[];
  /** Set only if this party also has an analysts row (i.e. holds agent/leader/pic in practice). */
  analystId: string | null;
  analystStatus: string | null;
  /** Set only if this party also has an introducers row. */
  introducerId: string | null;
}

/**
 * Role Detection: resolves the logged-in Supabase Auth user to their internal
 * identity + role list + linked analyst/introducer identity (a user can be
 * both — e.g. an Agent who is also an Introducer of a friend). Returns null
 * if there's no session — callers decide whether that means redirect (pages)
 * or a 401-style error (actions).
 *
 * This is a convenience read, not the authorization boundary — every
 * privileged Server Action still calls is_back_office() / hasRole() (or a
 * specific RPC's own internal check) against the caller's own session
 * independently. See the same note in admin/registrations/actions.ts.
 */
export async function getPortalUserContext(): Promise<PortalUserContext | null> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const { data: userRow } = await supabase
    .from("users")
    .select("id, party_id, status")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();
  if (!userRow) return null;
  if (userRow.status === "suspended") return null;

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
    .filter((name): name is PortalRole => !!name);

  const [{ data: analyst }, { data: introducer }] = await Promise.all([
    supabase.from("analysts").select("id, status").eq("party_id", userRow.party_id).maybeSingle(),
    supabase.from("introducers").select("id").eq("party_id", userRow.party_id).maybeSingle(),
  ]);

  return {
    userId: userRow.id,
    authUserId: authUser.id,
    partyId: userRow.party_id,
    fullName: identity?.full_name ?? "—",
    email: identity?.email ?? authUser.email ?? "—",
    roles,
    analystId: analyst?.id ?? null,
    analystStatus: analyst?.status ?? null,
    introducerId: introducer?.id ?? null,
  };
}
