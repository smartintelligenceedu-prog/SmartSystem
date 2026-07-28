"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ct } from "@/lib/i18n-client";
import { updateDepositOrderAmount, type EditInstitutionalOrderState } from "./actions";

const initialState: EditInstitutionalOrderState = { status: "idle" };

// Deposit shell orders are a single amount, not item_name/student rows —
// this is deliberately a much smaller form than EditInstitutionalOrderForm.
export function EditDepositOrderForm({
  orderId,
  currentAmount,
  onCancel,
  onSuccess,
}: {
  orderId: string;
  currentAmount: number;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const boundUpdate = updateDepositOrderAmount.bind(null, orderId);
  const [state, formAction, isPending] = useActionState(boundUpdate, initialState);

  useEffect(() => {
    if (state.status === "success") onSuccess();
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <Input
        name="amount"
        type="number"
        step="0.01"
        min="0.01"
        defaultValue={currentAmount}
        placeholder={ct("finance.institutional.field.amount")}
        className="w-32"
      />
      <div className="flex items-center gap-1">
        <Button type="submit" size="sm" disabled={isPending}>
          {ct("finance.institutional.edit_order.submit")}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={onCancel}>
          {ct("finance.institutional.edit_order.cancel")}
        </Button>
      </div>
      {state.status === "error" && (
        <p className="text-xs text-destructive" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
