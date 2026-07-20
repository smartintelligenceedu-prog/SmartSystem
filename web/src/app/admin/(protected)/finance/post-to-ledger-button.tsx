"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { postToLedger } from "./actions";
import { ct } from "@/lib/i18n-client";

export function PostToLedgerButton({ unpostedCount }: { unpostedCount: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <Button
        disabled={isPending || unpostedCount === 0}
        onClick={() =>
          startTransition(async () => {
            const result = await postToLedger();
            setMessage(result.message);
            if (result.ok) router.refresh();
          })
        }
      >
        {isPending
          ? ct("finance.unposted_list.posting")
          : `${ct("finance.post_button.post_prefix")}${unpostedCount}${ct("finance.post_button.post_suffix")}`}
      </Button>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
