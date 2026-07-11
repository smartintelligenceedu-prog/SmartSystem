"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createSalesOrder, type CreateSalesOrderState } from "../actions";

const initialState: CreateSalesOrderState = { status: "idle" };

export function NewSalesOrderForm({
  customers,
  vouchers,
}: {
  customers: { id: string; name: string }[];
  vouchers: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(createSalesOrder, initialState);
  const [mode, setMode] = useState<"pay_now" | "redeem_voucher">("pay_now");

  useEffect(() => {
    if (state.status === "success") {
      router.push("/admin/sales-orders");
    }
  }, [state, router]);

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customer_id">顾客</Label>
            {/* Base UI's Select.Value shows the raw value unless Root gets an
                `items` map — see the same note in register-form.tsx. */}
            <Select name="customer_id" items={customers.map((c) => ({ value: c.id, label: c.name }))} required>
              <SelectTrigger id="customer_id" className="w-full">
                <SelectValue placeholder="请选择顾客" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {customers.length === 0 && (
              <p className="text-xs text-muted-foreground">你还没有登记任何顾客，请先登记顾客。</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>付款方式</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === "pay_now" ? "default" : "outline"}
                onClick={() => setMode("pay_now")}
              >
                现场付款（上传截图）
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "redeem_voucher" ? "default" : "outline"}
                disabled={vouchers.length === 0}
                onClick={() => setMode("redeem_voucher")}
              >
                兑换检测券{vouchers.length === 0 ? "（没有可用的券）" : ""}
              </Button>
            </div>
            <input type="hidden" name="mode" value={mode} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">{mode === "pay_now" ? "顾客付款金额 (RM)" : "顾客实付金额 (RM)"}</Label>
            <Input id="amount" name="amount" type="number" step="0.01" min="0.01" required />
          </div>

          {mode === "pay_now" ? (
            <div className="space-y-2">
              <Label htmlFor="payment_screenshot">上传缴费截图</Label>
              <Input id="payment_screenshot" name="payment_screenshot" type="file" accept="image/*,.pdf" required />
              <p className="text-xs text-muted-foreground">上传后订单会先是「待处理」，等后台核实截图后才会生效并计算佣金。</p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="voucher_id">选择要兑换的检测券</Label>
              <Select name="voucher_id" items={vouchers.map((v) => ({ value: v.id, label: v.label }))} required>
                <SelectTrigger id="voucher_id" className="w-full">
                  <SelectValue placeholder="请选择检测券" />
                </SelectTrigger>
                <SelectContent>
                  {vouchers.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">兑换检测券的订单会立即生效，不需要后台审核。</p>
            </div>
          )}

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isPending || customers.length === 0}>
            {isPending ? "处理中…" : "建立订单"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
