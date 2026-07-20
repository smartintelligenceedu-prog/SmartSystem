// Pure role types/helpers with no server-only dependency, so client
// components can import PortalRole without pulling in the server-only
// getPortalUserContext() from context.ts. Display labels now live in
// locales/*.json under the "role.*" keys (see ROLE_KEY maps at each call site).

export type PortalRole = "admin" | "finance" | "back_office" | "agent" | "leader" | "introducer" | "pic";

export interface RolesBearer {
  roles: PortalRole[];
}

export function hasRole(context: RolesBearer | null, role: PortalRole): boolean {
  return context?.roles.includes(role) ?? false;
}

export function hasAnyRole(context: RolesBearer | null, roles: PortalRole[]): boolean {
  return roles.some((role) => hasRole(context, role));
}

export function isBackOfficeRole(context: RolesBearer | null): boolean {
  return hasAnyRole(context, ["admin", "finance", "back_office"]);
}
