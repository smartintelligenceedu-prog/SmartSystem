"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { adminApproveCommission } from "./actions";
import { ct } from "@/lib/i18n-client";

export function ApproveCommissionButton({ recordId }: { recordId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await adminApproveCommission(recordId);
            setMessage(result.message);
            if (result.ok) router.refresh();
          })
        }
      >
        {isPending ? ct("commission.approve_button.approving") : ct("commission.approve_button.approve")}
      </Button>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
