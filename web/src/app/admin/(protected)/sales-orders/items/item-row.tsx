"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateSalesItem, toggleSalesItemActive } from "../actions";
import type { SalesItemRow } from "../data";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

export function ItemRow({ item }: { item: SalesItemRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(String(item.price));
  const [message, setMessage] = useState<string | null>(null);

  if (editing) {
    return (
      <div className="flex flex-col gap-1 px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 flex-1" />
          <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="h-8 w-28" />
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await updateSalesItem(item.id, name, Number(price));
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
        </div>
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <div>
        <p>
          {item.name}
          {item.item_kind === "discount" && (
            <Badge variant="outline" className="ml-2 text-[10px]">
              折扣
            </Badge>
          )}
          {!item.is_active && (
            <Badge variant="outline" className="ml-2 text-[10px] text-muted-foreground">
              已停用
            </Badge>
          )}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="tabular-nums">{formatMYR(item.price)}</span>
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          调整
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await toggleSalesItemActive(item.id, !item.is_active);
              router.refresh();
            })
          }
        >
          {item.is_active ? "停用" : "启用"}
        </Button>
      </div>
    </div>
  );
}
