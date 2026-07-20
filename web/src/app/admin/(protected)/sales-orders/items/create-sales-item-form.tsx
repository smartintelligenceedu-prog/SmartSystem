"use client";

import { useActionState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createSalesItem, type CreateSalesItemState } from "../actions";
import { ct } from "@/lib/i18n-client";

const KIND_OPTIONS = [
  { value: "item", label: ct("sales_orders.item_form.kind.item") },
  { value: "discount", label: ct("sales_orders.item_form.kind.discount") },
];

const initialState: CreateSalesItemState = { status: "idle" };

export function CreateSalesItemForm() {
  const [state, formAction, isPending] = useActionState(createSalesItem, initialState);
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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">{ct("sales_orders.item_form.name_label")}</Label>
              <Input id="name" name="name" placeholder={ct("sales_orders.item_form.name_placeholder")} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">{ct("sales_orders.item_form.price_label")}</Label>
              <Input id="price" name="price" type="number" step="0.01" required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="item_kind">{ct("sales_orders.item_form.kind_label")}</Label>
            <Select name="item_kind" defaultValue="item" items={KIND_OPTIONS}>
              <SelectTrigger id="item_kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "success" && <p className="text-sm">{ct("sales_orders.item_form.created")}</p>}

          <Button type="submit" disabled={isPending}>
            {isPending ? ct("sales_orders.item_form.creating") : ct("sales_orders.item_form.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
