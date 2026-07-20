"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminUpdateIntroducerAssignedAnalyst } from "./actions";

export function AssignedAnalystCell({
  introducerId,
  currentAnalystId,
  currentAnalystName,
  analysts,
}: {
  introducerId: string;
  currentAnalystId: string | null;
  currentAnalystName: string | null;
  analysts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(currentAnalystId ?? "");
  const [message, setMessage] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{currentAnalystName ?? "未指定"}</span>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          更改
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={selected} items={analysts.map((a) => ({ value: a.id, label: a.name }))} onValueChange={(v) => setSelected(v ?? "")}>
        <SelectTrigger className="h-8 w-40">
          <SelectValue placeholder="不指定" />
        </SelectTrigger>
        <SelectContent>
          {analysts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await adminUpdateIntroducerAssignedAnalyst(introducerId, selected || null);
            setMessage(result.message);
            if (result.ok) {
              setEditing(false);
              router.refresh();
            }
          })
        }
      >
        储存
      </Button>
      <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setEditing(false)}>
        取消
      </Button>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
