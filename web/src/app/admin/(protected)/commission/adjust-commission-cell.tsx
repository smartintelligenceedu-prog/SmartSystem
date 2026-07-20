"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { adminAdjustCommission } from "./actions";
import { ct } from "@/lib/i18n-client";

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
        {ct("commission.cell.adjust")}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {customerName && (
        <p className="text-xs text-muted-foreground">
          {ct("commission.cell.customer_prefix")}
          {customerName}
          {customerPhoneMasked && ` ${customerPhoneMasked}`}
          {priorSettlementDate && (
            <span className="ml-1 text-amber-600">
              {ct("commission.cell.prior_settlement_prefix")}
              {new Date(priorSettlementDate).toLocaleDateString("zh-CN")}
              {ct("commission.cell.prior_settlement_suffix")}
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
          placeholder={ct("commission.cell.new_amount_placeholder")}
          className="h-8 w-24"
        />
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={ct("commission.cell.reason_placeholder")}
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
          {ct("commission.cell.confirm")}
        </Button>
        <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setEditing(false)}>
          {ct("commission.cell.cancel")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {ct("commission.cell.original_amount_prefix")}
        {formatMYR(currentAmount)}
      </p>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
