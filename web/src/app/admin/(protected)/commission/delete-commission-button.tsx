"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { adminDeleteCommission } from "./actions";
import { ct } from "@/lib/i18n-client";

export function DeleteCommissionButton({ recordId }: { recordId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div>
      <Button
        size="sm"
        variant="outline"
        className="text-destructive"
        disabled={isPending}
        onClick={() => {
          if (!window.confirm(ct("commission.action.confirm_delete"))) return;
          startTransition(async () => {
            const result = await adminDeleteCommission(recordId);
            setMessage(result.message);
            if (result.ok) router.refresh();
          });
        }}
      >
        {ct("commission.action.delete")}
      </Button>
      {message && <p className="mt-1 text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
