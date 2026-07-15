"use client";

import { useActionState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/lib/i18n";
import { createStaffPayslip, type CreateStaffPayslipState } from "./actions";

const initialState: CreateStaffPayslipState = { status: "idle" };

export function CreateStaffPayslipForm({ recipients }: { recipients: { party_id: string; name: string }[] }) {
  const [state, formAction, isPending] = useActionState(createStaffPayslip, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <Card>
      <CardContent className="pt-6">
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="party_id">{t("payroll.staff.recipient_label")}</Label>
            {/* Base UI's Select.Value shows the raw value unless Root gets an
                `items` map — see the same note in register-form.tsx. */}
            <Select name="party_id" items={recipients.map((r) => ({ value: r.party_id, label: r.name }))}>
              <SelectTrigger id="party_id" className="w-full">
                <SelectValue placeholder={t("payroll.staff.recipient_placeholder")} />
              </SelectTrigger>
              <SelectContent>
                {recipients.map((r) => (
                  <SelectItem key={r.party_id} value={r.party_id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="period_start">{t("payroll.run.period_start_label")}</Label>
              <Input id="period_start" name="period_start" type="date" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="period_end">{t("payroll.run.period_end_label")}</Label>
              <Input id="period_end" name="period_end" type="date" required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="gross_amount">{t("payroll.staff.amount_label")}</Label>
            <Input id="gross_amount" name="gross_amount" type="number" step="0.01" min="0" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">{t("payroll.staff.description_label")}</Label>
            <Input id="description" name="description" placeholder={t("payroll.staff.description_placeholder")} />
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "success" && <p className="text-sm">{t("payroll.staff.success")}</p>}

          <Button type="submit" disabled={isPending}>
            {isPending ? t("payroll.staff.submitting") : t("payroll.staff.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
