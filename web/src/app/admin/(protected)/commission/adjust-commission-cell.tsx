"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { adminAdjustCommission } from "./actions";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

export function AdjustCommissionCell({
  recordId,
  currentAmount,
  customerName,
  customerPhoneMasked,
  priorSettlementDate,
}: {
  recordId: string;
  currentAmount: number;
  customerName?: string | null;
  customerPhoneMasked?: string | null;
  priorSettlementDate?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(currentAmount));
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  if (!editing) {
    return (
      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
        调整
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {customerName && (
        <p className="text-xs text-muted-foreground">
          顾客：{customerName}
          {customerPhoneMasked && ` ${customerPhoneMasked}`}
          {priorSettlementDate && (
            <span className="ml-1 text-amber-600">
              ⚠ 该手机号已于 {new Date(priorSettlementDate).toLocaleDateString("zh-CN")} 结算过
            </span>
          )}
        </p>
      )}
      <div className="flex items-center gap-1">
        <Input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="新金额"
          className="h-8 w-24"
        />
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="调整原因"
          className="h-8 w-36"
        />
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await adminAdjustCommission(recordId, Number(amount), reason);
              setMessage(result.message);
              if (result.ok) {
                setEditing(false);
                router.refresh();
              }
            })
          }
        >
          确认
        </Button>
        <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setEditing(false)}>
          取消
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">原金额 {formatMYR(currentAmount)}</p>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
