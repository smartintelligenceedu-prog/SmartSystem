"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { adminResetIntroducerPassword } from "../introducers/actions";
import { ct } from "@/lib/i18n-client";

export function ResetPasswordCell({ introducerId }: { introducerId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => {
          if (!window.confirm(ct("introducers.detail.confirm_reset_password"))) return;
          startTransition(async () => {
            const result = await adminResetIntroducerPassword(introducerId);
            setMessage(result.message);
            if (result.ok) router.refresh();
          });
        }}
      >
        {ct("introducers.detail.reset_password_button")}
      </Button>
      {message && <p className="max-w-[220px] text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
