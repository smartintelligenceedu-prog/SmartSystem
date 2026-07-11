import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOut } from "../../login/actions";
import type { PortalUserContext, BackOfficeRole } from "@/lib/auth/context";

const ROLE_LABEL: Record<BackOfficeRole, string> = {
  admin: "管理员",
  finance: "财务",
  back_office: "后台人员",
};

export function Header({ context }: { context: PortalUserContext }) {
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
              {ROLE_LABEL[role]}
            </Badge>
          ))}
        </div>
        <form action={signOut}>
          <Button variant="ghost" size="sm" type="submit">
            登出
          </Button>
        </form>
      </div>
    </header>
  );
}
