"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/i18n-client";
import { voidOperatingExpense } from "./actions";

export function VoidExpenseButton({ journalEntryId }: { journalEntryId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function doVoid() {
    if (!window.confirm(ct("finance.page.void_expense_confirm"))) return;
    startTransition(async () => {
      const result = await voidOperatingExpense(journalEntryId);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="xs" variant="ghost" onClick={doVoid} disabled={isPending}>
        {ct("finance.page.void_expense_button")}
      </Button>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
