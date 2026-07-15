"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { approveIntroducerApplication, rejectIntroducerApplication } from "./actions";

export function ReviewRowActions({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  if (rejecting) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="拒绝原因" className="h-8 w-36" />
          <Button
            size="sm"
            variant="destructive"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await rejectIntroducerApplication(applicationId, reason);
                setMessage(result.message);
                if (result.ok) router.refresh();
              })
            }
          >
            确认拒绝
          </Button>
          <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setRejecting(false)}>
            取消
          </Button>
        </div>
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await approveIntroducerApplication(applicationId);
              setMessage(result.message);
              if (result.ok) router.refresh();
            })
          }
        >
          {isPending ? "处理中…" : "核准"}
        </Button>
        <Button size="sm" variant="outline" disabled={isPending} onClick={() => setRejecting(true)}>
          拒绝
        </Button>
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
