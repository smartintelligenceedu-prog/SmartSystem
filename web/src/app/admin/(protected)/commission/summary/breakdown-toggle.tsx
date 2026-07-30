"use client";

import { useState } from "react";
import { ct } from "@/lib/i18n-client";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

export function BreakdownToggle({
  name,
  breakdown,
  triggerLabelByType,
}: {
  name: string;
  breakdown: { trigger_type: string; amount: number; count: number }[];
  triggerLabelByType: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button type="button" className="text-left font-medium underline decoration-dotted underline-offset-2" onClick={() => setOpen(!open)}>
        {name}
      </button>
      {open && (
        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {breakdown.length === 0 && <p>{ct("commission.summary.no_breakdown")}</p>}
          {breakdown.map((b) => (
            <p key={b.trigger_type} className="flex justify-between gap-3">
              <span>
                {triggerLabelByType[b.trigger_type] ?? b.trigger_type} × {b.count}
              </span>
              <span className="tabular-nums">{formatMYR(b.amount)}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
