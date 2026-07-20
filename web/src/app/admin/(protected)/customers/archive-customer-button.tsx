"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setCustomerArchived } from "./actions";
import { ct } from "@/lib/i18n-client";

export function ArchiveCustomerButton({ customerId, isArchived }: { customerId: string; isArchived: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await setCustomerArchived(customerId, !isArchived);
            if (!result.ok) setMessage(result.message);
            else router.refresh();
          })
        }
      >
        {isArchived ? ct("customer.list.action.restore") : ct("customer.list.action.archive")}
      </Button>
      {message && <p className="text-xs text-destructive">{message}</p>}
    </div>
  );
}
