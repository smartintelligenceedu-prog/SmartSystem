"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ct } from "@/lib/i18n-client";
import { updateInstitutionalPackageCommission, type UpdatePackageCommissionState } from "./actions";
import { submitWithoutReset } from "@/lib/submit-without-reset";
import type { PackageRow } from "./data";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

const initialState: UpdatePackageCommissionState = { status: "idle" };

export function EditPackageCommissionCell({ pkg, agents }: { pkg: PackageRow; agents: { id: string; name: string }[] }) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [responsibleAnalystId, setResponsibleAnalystId] = useState(pkg.responsible_analyst_id ?? "");
  const boundUpdate = updateInstitutionalPackageCommission.bind(null, pkg.id);
  const [state, formAction, isPending] = useActionState(boundUpdate, initialState);

  useEffect(() => {
    if (state.status === "success") {
      setIsEditing(false);
      router.refresh();
    }
  }, [state, router]);

  if (!isEditing) {
    return (
      <div className="flex flex-col items-start gap-1">
        <div className="text-xs text-muted-foreground">
          {pkg.report_override_amount !== null && (
            <div>
              {formatMYR(pkg.report_override_amount)} → {ct("finance.institutional.package.responsible_analyst_label")}
            </div>
          )}
          {pkg.analyst_report_fee_amount !== null && (
            <div>
              {formatMYR(pkg.analyst_report_fee_amount)} → {ct("finance.institutional.package.analyst_fee_label")}
            </div>
          )}
          {pkg.deposit_commission_amount !== null && (
            <div>
              {formatMYR(pkg.deposit_commission_amount)} → {ct("finance.institutional.package.deposit_commission_label")}
            </div>
          )}
          {pkg.report_override_amount === null && pkg.analyst_report_fee_amount === null && pkg.deposit_commission_amount === null && "—"}
        </div>
        <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
          {ct("finance.institutional.package.edit_commission")}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submitWithoutReset(formAction)} className="flex flex-col gap-2">
      <div className="space-y-1">
        <Label className="text-xs">{ct("finance.institutional.package.responsible_analyst_label")}</Label>
        <Select
          items={agents.map((a) => ({ value: a.id, label: a.name }))}
          value={responsibleAnalystId || undefined}
          onValueChange={(v) => setResponsibleAnalystId((v as string) ?? "")}
        >
          <SelectTrigger className="h-8 w-40">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input type="hidden" name="responsible_analyst_id" value={responsibleAnalystId} />
      </div>
      <Input
        name="report_override_amount"
        type="number"
        step="0.01"
        min="0"
        defaultValue={pkg.report_override_amount ?? ""}
        placeholder={ct("finance.institutional.package.report_override_label")}
        className="h-8 w-40"
      />
      <Input
        name="analyst_report_fee_amount"
        type="number"
        step="0.01"
        min="0"
        defaultValue={pkg.analyst_report_fee_amount ?? ""}
        placeholder={ct("finance.institutional.package.analyst_fee_label")}
        className="h-8 w-40"
      />
      <Input
        name="deposit_commission_amount"
        type="number"
        step="0.01"
        min="0"
        defaultValue={pkg.deposit_commission_amount ?? ""}
        placeholder={ct("finance.institutional.package.deposit_commission_label")}
        className="h-8 w-40"
      />
      <div className="flex gap-1">
        <Button type="submit" size="sm" disabled={isPending}>
          {ct("finance.institutional.edit_order.submit")}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setIsEditing(false)}>
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
