"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { approveIntroducerApplication, rejectIntroducerApplication } from "./actions";
import { ct } from "@/lib/i18n-client";

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
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={ct("introducer_applications.row.reason_placeholder")}
            className="h-8 w-36"
          />
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
            {ct("introducer_applications.row.confirm_reject")}
          </Button>
          <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setRejecting(false)}>
            {ct("introducer_applications.row.cancel")}
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
          {isPending ? ct("introducer_applications.row.processing") : ct("introducer_applications.row.approve")}
        </Button>
        <Button size="sm" variant="outline" disabled={isPending} onClick={() => setRejecting(true)}>
          {ct("introducer_applications.row.reject")}
        </Button>
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
