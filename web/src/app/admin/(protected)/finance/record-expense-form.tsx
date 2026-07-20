"use client";

import { useActionState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { recordOperatingExpense, type RecordExpenseState } from "./actions";
import { ct } from "@/lib/i18n-client";

const CATEGORY_OPTIONS = [
  { value: "software", label: ct("finance.expense_form.category.software") },
  { value: "office", label: ct("finance.expense_form.category.office") },
  { value: "other", label: ct("finance.expense_form.category.other") },
];

const initialState: RecordExpenseState = { status: "idle" };

function today() {
  return new Date().toLocaleDateString("en-CA");
}

export function RecordExpenseForm() {
  const [state, formAction, isPending] = useActionState(recordOperatingExpense, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <Card>
      <CardContent className="pt-6">
        <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="expense_date">{ct("finance.expense_form.date_label")}</Label>
            <Input id="expense_date" name="expense_date" type="date" defaultValue={today()} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expense_category">{ct("finance.expense_form.category_label")}</Label>
            {/* Base UI's Select.Value shows the raw value unless Root gets an
                `items` map — see the same note in register-form.tsx. Reads
                via FormData (name="category") like every other Select in
                this codebase, not manual useState + onValueChange. */}
            <Select name="category" defaultValue="software" items={CATEGORY_OPTIONS}>
              <SelectTrigger id="expense_category" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-48 flex-1 space-y-2">
            <Label htmlFor="expense_description">{ct("finance.expense_form.description_label")}</Label>
            <Input id="expense_description" name="description" placeholder={ct("finance.expense_form.description_placeholder")} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expense_amount">{ct("finance.expense_form.amount_label")}</Label>
            <Input id="expense_amount" name="amount" type="number" step="0.01" min="0" className="w-32" required />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? ct("finance.expense_form.recording") : ct("finance.expense_form.submit")}
          </Button>
        </form>
        {state.status === "error" && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {state.message}
          </p>
        )}
        {state.status === "success" && <p className="mt-2 text-sm">{ct("finance.expense_form.success")}</p>}
      </CardContent>
    </Card>
  );
}
