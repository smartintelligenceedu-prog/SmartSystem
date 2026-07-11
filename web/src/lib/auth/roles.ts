// Pure role types/helpers with no server-only dependency, so client
// components (e.g. profile-form.tsx) can import ROLE_LABEL without pulling
// in the server-only getPortalUserContext() from context.ts.

export type PortalRole = "admin" | "finance" | "back_office" | "agent" | "leader" | "introducer" | "pic";

export const ROLE_LABEL: Record<PortalRole, string> = {
  admin: "管理员",
  finance: "财务",
  back_office: "后台人员",
  agent: "分析师",
  leader: "团队主管",
  introducer: "引荐人",
  pic: "通路负责人",
};

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
