"use client";

import { useActionState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { runMonthlyPayout, type RunPayoutState } from "./actions";

const initialState: RunPayoutState = { status: "idle" };

function firstOfLastMonth() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return d.toLocaleDateString("en-CA");
}

function lastOfLastMonth() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), 0);
  return d.toLocaleDateString("en-CA");
}

export function RunPayoutForm() {
  const [state, formAction, isPending] = useActionState(runMonthlyPayout, initialState);

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="period_start">{t("payroll.run.period_start_label")}</Label>
            <Input id="period_start" name="period_start" type="date" defaultValue={firstOfLastMonth()} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="period_end">{t("payroll.run.period_end_label")}</Label>
            <Input id="period_end" name="period_end" type="date" defaultValue={lastOfLastMonth()} required />
          </div>
          <Button type="submit" disabled={isPending}>
            {t("payroll.run.submit")}
          </Button>
        </form>
        {state.status === "error" && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {state.message}
          </p>
        )}
        {state.status === "success" && <p className="mt-2 text-sm">{state.message}</p>}
      </CardContent>
    </Card>
  );
}
