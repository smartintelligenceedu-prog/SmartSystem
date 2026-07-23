"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminReassignCommission } from "./actions";
import { ct } from "@/lib/i18n-client";

export function ReassignCommissionControl({
  recordId,
  currentAnalystId,
  analystOptions,
}: {
  recordId: string;
  currentAnalystId: string | null;
  analystOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(currentAnalystId ?? "");
  const [message, setMessage] = useState<string | null>(null);

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {ct("commission.action.reassign")}
      </Button>
    );
  }

  const items = analystOptions.map((a) => ({ value: a.id, label: a.name }));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Select items={items} value={selected} onValueChange={(v) => setSelected(v ?? "")}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder={ct("commission.action.reassign_placeholder")} />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={isPending || !selected || selected === currentAnalystId}
          onClick={() =>
            startTransition(async () => {
              const result = await adminReassignCommission(recordId, selected);
              setMessage(result.message);
              if (result.ok) {
                setOpen(false);
                router.refresh();
              }
            })
          }
        >
          {ct("commission.cell.confirm")}
        </Button>
        <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setOpen(false)}>
          {ct("commission.cell.cancel")}
        </Button>
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
