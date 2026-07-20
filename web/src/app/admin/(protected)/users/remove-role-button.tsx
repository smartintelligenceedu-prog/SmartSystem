"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { XIcon } from "lucide-react";
import { adminRemoveRole } from "./actions";
import { ct } from "@/lib/i18n-client";

export function RemoveRoleButton({ userId, role }: { userId: string; role: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      aria-label={`${ct("users.remove_role.aria_prefix")}${role}${ct("users.remove_role.aria_suffix")}`}
      disabled={isPending}
      className="cursor-pointer disabled:opacity-50"
      onClick={() =>
        startTransition(async () => {
          const result = await adminRemoveRole(userId, role);
          if (result.ok) router.refresh();
          else alert(result.message);
        })
      }
    >
      <XIcon className="size-3" />
    </button>
  );
}
