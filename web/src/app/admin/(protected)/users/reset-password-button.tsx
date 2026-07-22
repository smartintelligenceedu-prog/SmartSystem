"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { adminResetUserPassword } from "./actions";
import { ct } from "@/lib/i18n-client";

export function ResetPasswordButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="mt-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => {
          if (!window.confirm(ct("users.action.confirm_reset_password"))) return;
          startTransition(async () => {
            const result = await adminResetUserPassword(userId);
            setMessage(result.message);
            if (result.ok) router.refresh();
          });
        }}
      >
        {ct("users.action.reset_password")}
      </Button>
      {message && <p className="mt-1 text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
