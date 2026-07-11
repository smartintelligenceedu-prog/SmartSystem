"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { XIcon } from "lucide-react";
import { adminRemoveRole } from "./actions";

export function RemoveRoleButton({ userId, role }: { userId: string; role: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      aria-label={`移除 ${role} 角色`}
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
