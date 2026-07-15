"use client";

import { useActionState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { recordOperatingExpense, type RecordExpenseState } from "./actions";

const CATEGORY_OPTIONS = [
  { value: "software", label: "软件订阅" },
  { value: "office", label: "办公与一般" },
  { value: "other", label: "其他" },
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
            <Label htmlFor="expense_date">日期</Label>
            <Input id="expense_date" name="expense_date" type="date" defaultValue={today()} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expense_category">类别</Label>
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
            <Label htmlFor="expense_description">说明</Label>
            <Input id="expense_description" name="description" placeholder="例如：Claude 订阅" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expense_amount">金额 (RM)</Label>
            <Input id="expense_amount" name="amount" type="number" step="0.01" min="0" className="w-32" required />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? "记录中…" : "记一笔开销"}
          </Button>
        </form>
        {state.status === "error" && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {state.message}
          </p>
        )}
        {state.status === "success" && <p className="mt-2 text-sm">已记录这笔开销</p>}
      </CardContent>
    </Card>
  );
}
