"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { postToLedger } from "./actions";
import type { UnpostedTransactionRow } from "./data";
import { ct } from "@/lib/i18n-client";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

function rowKey(tx: UnpostedTransactionRow) {
  return `${tx.type}-${tx.id}`;
}

export function UnpostedTransactionsList({ transactions }: { transactions: UnpostedTransactionRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  // Pending (not-yet-approved) commissions start unchecked so finance can
  // post everything else first without accidentally recording an unreviewed
  // expense — the exact workflow the user asked for.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(transactions.filter((tx) => !tx.pending).map(rowKey))
  );

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allSelected = selected.size === transactions.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(transactions.map(rowKey)));
  };

  const selectedCount = selected.size;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={toggleAll} className="text-xs text-muted-foreground hover:underline">
          {allSelected ? ct("finance.unposted_list.deselect_all") : ct("finance.unposted_list.select_all")}
        </button>
        <div className="flex items-center gap-2">
          {message && <span className="text-xs text-muted-foreground">{message}</span>}
          <Button
            size="sm"
            disabled={isPending || selectedCount === 0}
            onClick={() =>
              startTransition(async () => {
                const orderIds = transactions.filter((tx) => tx.type === "order" && selected.has(rowKey(tx))).map((tx) => tx.id);
                const commissionIds = transactions
                  .filter((tx) => tx.type === "commission" && selected.has(rowKey(tx)))
                  .map((tx) => tx.id);
                const result = await postToLedger({ orderIds, commissionIds });
                setMessage(result.message);
                if (result.ok) router.refresh();
              })
            }
          >
            {isPending
              ? ct("finance.unposted_list.posting")
              : `${ct("finance.unposted_list.post_selected_prefix")}${selectedCount}${ct("finance.unposted_list.post_selected_suffix")}`}
          </Button>
        </div>
      </div>
      <div className="max-h-96 divide-y overflow-y-auto rounded-md border">
        {transactions.map((tx) => {
          const key = rowKey(tx);
          return (
            <label key={key} className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-accent/30">
              <div className="flex items-center gap-3">
                <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} className="size-4" />
                <div>
                  <p>
                    {tx.description}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {tx.type === "order" ? ct("finance.unposted_list.type_order") : ct("finance.unposted_list.type_commission")}
                    </span>
                    {tx.pending && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {ct("finance.unposted_list.not_approved_badge")}
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {tx.subject} · {new Date(tx.date).toLocaleDateString("zh-CN")}
                  </p>
                </div>
              </div>
              <span className="tabular-nums">{formatMYR(tx.amount)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
