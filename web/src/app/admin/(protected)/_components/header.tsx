import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOut } from "../../login/actions";
import { NotificationsBell } from "./notifications-bell";
import type { PortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole, type PortalRole } from "@/lib/auth/roles";
import { t, type TranslationKey } from "@/lib/i18n";

const ROLE_KEY: Record<PortalRole, TranslationKey> = {
  admin: "role.admin",
  finance: "role.finance",
  back_office: "role.back_office",
  agent: "role.agent",
  leader: "role.leader",
  introducer: "role.introducer",
  pic: "role.pic",
};

export async function Header({ context }: { context: PortalUserContext }) {
  const roleLabelByRole = Object.fromEntries(
    await Promise.all(Object.entries(ROLE_KEY).map(async ([k, key]) => [k, await t(key)]))
  ) as Record<PortalRole, string>;

  return (
    <header className="flex items-center justify-between border-b border-white/10 bg-[linear-gradient(90deg,#0d1b2a_0%,#1b263b_50%,#0d1b2a_100%)] px-6 py-3">
      <div />
      <div className="flex items-center gap-3">
        {isBackOfficeRole(context) && <NotificationsBell />}
        <div className="text-right">
          <p className="text-sm font-medium leading-tight text-white">{context.fullName}</p>
          <p className="text-xs leading-tight text-white/60">{context.email}</p>
        </div>
        <div className="flex gap-1">
          {context.roles.map((role) => (
            <Badge key={role} variant="secondary" className="border-white/20 bg-white/10 text-white">
              {roleLabelByRole[role]}
            </Badge>
          ))}
        </div>
        <form action={signOut}>
          <Button variant="ghost" size="sm" type="submit" className="text-white hover:bg-white/10 hover:text-white">
            {await t("header.sign_out")}
          </Button>
        </form>
      </div>
    </header>
  );
}
