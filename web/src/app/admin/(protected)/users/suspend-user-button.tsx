"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { adminSetUserStatus } from "./actions";
import { ct } from "@/lib/i18n-client";

export function SuspendUserButton({ userId, status }: { userId: string; status: "active" | "suspended" }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const nextStatus = status === "active" ? "suspended" : "active";

  return (
    <Button
      type="button"
      size="sm"
      variant={status === "active" ? "outline" : "secondary"}
      disabled={isPending}
      onClick={() => {
        if (nextStatus === "suspended" && !window.confirm(ct("users.action.confirm_suspend"))) return;
        startTransition(async () => {
          const result = await adminSetUserStatus(userId, nextStatus);
          if (result.ok) router.refresh();
          else alert(result.message);
        });
      }}
    >
      {status === "active" ? ct("users.action.suspend") : ct("users.action.activate")}
    </Button>
  );
}
