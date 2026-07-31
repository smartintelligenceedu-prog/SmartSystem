"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ct } from "@/lib/i18n-client";
import { updateExpenseDescription } from "./actions";

export function EditExpenseDescription({
  journalEntryId,
  description,
  strikethrough,
}: {
  journalEntryId: string;
  description: string;
  strikethrough: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(description);
  const [message, setMessage] = useState<string | null>(null);

  if (!isEditing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={strikethrough ? "text-muted-foreground line-through" : ""}>{description}</span>
        <button
          type="button"
          onClick={() => {
            setValue(description);
            setIsEditing(true);
          }}
          className="text-xs text-muted-foreground underline decoration-dotted hover:text-foreground"
        >
          {ct("finance.page.edit_description_button")}
        </button>
      </span>
    );
  }

  function save() {
    startTransition(async () => {
      const result = await updateExpenseDescription(journalEntryId, value);
      setMessage(result.message);
      if (result.ok) {
        setIsEditing(false);
        router.refresh();
      }
    });
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-7 w-64 text-sm" disabled={isPending} />
        <Button size="xs" onClick={save} disabled={isPending}>
          {ct("finance.page.save_description_button")}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setIsEditing(false)} disabled={isPending}>
          {ct("finance.page.cancel_description_button")}
        </Button>
      </span>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </span>
  );
}
