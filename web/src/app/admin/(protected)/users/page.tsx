import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasRole } from "@/lib/auth/roles";
import { listBackOfficeUsers } from "./data";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateUserForm } from "./create-user-form";
import { RemoveRoleButton } from "./remove-role-button";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  finance: "财务",
  back_office: "后台人员",
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

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">帐号管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">仅管理员可见 — 新增或调整后台人员的角色权限</p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>姓名</TableHead>
              <TableHead>电邮</TableHead>
              <TableHead>角色</TableHead>
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
                        {ROLE_LABEL[role] ?? role}
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
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">新增后台帐号</h2>
        <CreateUserForm />
      </div>
    </div>
  );
}
