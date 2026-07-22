"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminAddRole } from "./actions";
import { ct } from "@/lib/i18n-client";

const ROLE_LABEL_KEY = {
  admin: "users.role.admin",
  finance: "users.role.finance",
  back_office: "users.role.back_office",
} as const;

// Only offered for roles this user doesn't already hold — inserting a role
// they already have would just hit the user_roles primary key and error.
export function AddRoleControl({ userId, missingRoles }: { userId: string; missingRoles: string[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [role, setRole] = useState("");

  if (missingRoles.length === 0) return null;

  const items = missingRoles.map((r) => ({ value: r, label: ct(ROLE_LABEL_KEY[r as keyof typeof ROLE_LABEL_KEY]) }));

  return (
    <div className="mt-1 flex items-center gap-1">
      <Select items={items} value={role} onValueChange={(v) => setRole(v ?? "")}>
        <SelectTrigger className="h-7 w-32 text-xs">
          <SelectValue placeholder={ct("users.add_role.placeholder")} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={!role || isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await adminAddRole(userId, role);
            if (result.ok) {
              setRole("");
              router.refresh();
            } else {
              alert(result.message);
            }
          })
        }
      >
        <PlusIcon className="size-3" />
      </Button>
    </div>
  );
}
