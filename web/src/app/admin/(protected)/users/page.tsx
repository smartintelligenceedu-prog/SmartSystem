import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasRole } from "@/lib/auth/roles";
import { listBackOfficeUsers } from "./data";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateUserForm } from "./create-user-form";
import { RemoveRoleButton } from "./remove-role-button";
import { t, type TranslationKey } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const ROLE_KEY: Record<string, TranslationKey> = {
  admin: "users.role.admin",
  finance: "users.role.finance",
  back_office: "users.role.back_office",
};

export default async function UsersPage() {
  // Page-level gate: the sidebar already hides this link from non-admins,
  // but the URL itself must refuse them too — a hidden link is not access
  // control. The Server Actions in actions.ts re-check independently again.
  const context = await getPortalUserContext();
  if (!hasRole(context, "admin")) {
    redirect("/admin");
  }

  const users = await listBackOfficeUsers();

  const roleLabelByRole = Object.fromEntries(
    await Promise.all(Object.entries(ROLE_KEY).map(async ([k, key]) => [k, await t(key)]))
  ) as Record<string, string>;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">{await t("users.page.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{await t("users.page.subtitle")}</p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{await t("users.page.column.name")}</TableHead>
              <TableHead>{await t("users.page.column.email")}</TableHead>
              <TableHead>{await t("users.page.column.roles")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.user_id}>
                <TableCell>{u.full_name}</TableCell>
                <TableCell className="text-muted-foreground">{u.email}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((role) => (
                      <Badge key={role} variant="secondary" className="gap-1">
                        {roleLabelByRole[role] ?? role}
                        <RemoveRoleButton userId={u.user_id} role={role} />
                      </Badge>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">
          {await t("users.page.create_heading")}
        </h2>
        <CreateUserForm />
      </div>
    </div>
  );
}
