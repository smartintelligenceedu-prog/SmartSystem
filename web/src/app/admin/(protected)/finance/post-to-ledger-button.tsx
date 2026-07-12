"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { postToLedger } from "./actions";

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
        {isPending ? "过帐中…" : `过帐 (${unpostedCount})`}
      </Button>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
