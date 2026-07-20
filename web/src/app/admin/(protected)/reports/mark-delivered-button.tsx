"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ct } from "@/lib/i18n-client";
import { markReportDelivered } from "./actions";
import type { ReportTier } from "./data";

const TIER_OPTIONS: { value: ReportTier; label: string }[] = [
  { value: "standard", label: ct("reports.tier.standard") },
  { value: "upgrade", label: ct("reports.tier.upgrade") },
];

export function MarkDeliveredButton({ orderItemId }: { orderItemId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tier, setTier] = useState<ReportTier>("standard");
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Select value={tier} items={TIER_OPTIONS} onValueChange={(v) => setTier((v as ReportTier) ?? "standard")}>
          <SelectTrigger className="w-28" size="sm">
            <SelectValue placeholder={ct("reports.mark_delivered.tier_placeholder")} />
          </SelectTrigger>
          <SelectContent>
            {TIER_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await markReportDelivered(orderItemId, tier);
              setMessage(result.message);
              if (result.ok) router.refresh();
            })
          }
        >
          {ct("reports.mark_delivered.submit")}
        </Button>
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
