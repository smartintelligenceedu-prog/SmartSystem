import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOut } from "../../login/actions";
import type { PortalUserContext } from "@/lib/auth/context";
import type { PortalRole } from "@/lib/auth/roles";
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
    <header className="flex items-center justify-between border-b px-6 py-3">
      <div />
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-sm font-medium leading-tight">{context.fullName}</p>
          <p className="text-xs text-muted-foreground leading-tight">{context.email}</p>
        </div>
        <div className="flex gap-1">
          {context.roles.map((role) => (
            <Badge key={role} variant="secondary">
              {roleLabelByRole[role]}
            </Badge>
          ))}
        </div>
        <form action={signOut}>
          <Button variant="ghost" size="sm" type="submit">
            {await t("header.sign_out")}
          </Button>
        </form>
      </div>
    </header>
  );
}
