"use client";

import { useActionState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createSalesItem, type CreateSalesItemState } from "../actions";

const KIND_OPTIONS = [
  { value: "item", label: "一般项目" },
  { value: "discount", label: "折扣 / 促销（金额可为负数）" },
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
              <Label htmlFor="name">项目名称</Label>
              <Input id="name" name="name" placeholder="例如：Standard Report" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">价格 (RM)</Label>
              <Input id="price" name="price" type="number" step="0.01" required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="item_kind">类型</Label>
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
          {state.status === "success" && <p className="text-sm">已建立</p>}

          <Button type="submit" disabled={isPending}>
            {isPending ? "建立中…" : "新增项目"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
