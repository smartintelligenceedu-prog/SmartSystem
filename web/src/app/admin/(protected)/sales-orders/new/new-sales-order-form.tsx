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

interface Member {
  customer_id: string;
  analyst_id: string;
  amount: string;
}

export function NewSalesOrderForm({
  ownAnalystId,
  ownAnalystName,
  customers,
  agents,
  vouchers,
}: {
  ownAnalystId: string;
  ownAnalystName: string;
  customers: { id: string; name: string }[];
  agents: { id: string; name: string }[];
  vouchers: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(createSalesOrder, initialState);
  const [mode, setMode] = useState<"pay_now" | "redeem_voucher">("pay_now");
  const [members, setMembers] = useState<Member[]>([{ customer_id: "", analyst_id: ownAnalystId, amount: "" }]);

  // redeem_voucher mode keeps the original single-person fields.
  const [voucherCustomerId, setVoucherCustomerId] = useState("");
  const [voucherAmount, setVoucherAmount] = useState("");

  useEffect(() => {
    if (state.status === "success") {
      router.push("/admin/sales-orders");
    }
  }, [state, router]);

  function addMember() {
    setMembers((prev) => [...prev, { customer_id: "", analyst_id: ownAnalystId, amount: "" }]);
  }
  function removeMember(index: number) {
    setMembers((prev) => prev.filter((_, i) => i !== index));
  }
  function updateMember(index: number, field: keyof Member, value: string) {
    setMembers((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
  }

  const agentOptions = agents.length > 0 ? agents : [{ id: ownAnalystId, name: ownAnalystName }];

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="mode" value={mode} />

          <div className="space-y-2">
            <Label>付款方式</Label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={mode === "pay_now" ? "default" : "outline"} onClick={() => setMode("pay_now")}>
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
          </div>

          {mode === "pay_now" ? (
            <>
              <input type="hidden" name="members_json" value={JSON.stringify(members)} />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>顾客（可加入多位，例如一家人一起来）</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addMember}>
                    新增顾客
                  </Button>
                </div>
                {customers.length === 0 && <p className="text-xs text-muted-foreground">你还没有登记任何顾客，请先登记顾客。</p>}
                {members.map((member, index) => (
                  <div key={index} className="space-y-2 rounded-md border p-3">
                    <div className="space-y-1">
                      <Label className="text-xs">顾客</Label>
                      <Select
                        items={customers.map((c) => ({ value: c.id, label: c.name }))}
                        value={member.customer_id}
                        onValueChange={(v) => updateMember(index, "customer_id", v ?? "")}
                      >
                        <SelectTrigger className="w-full">
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
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">负责分析师</Label>
                        <Select
                          items={agentOptions.map((a) => ({ value: a.id, label: a.name }))}
                          value={member.analyst_id}
                          onValueChange={(v) => updateMember(index, "analyst_id", v ?? "")}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="请选择分析师" />
                          </SelectTrigger>
                          <SelectContent>
                            {agentOptions.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">付款金额 (RM)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={member.amount}
                          onChange={(e) => updateMember(index, "amount", e.target.value)}
                        />
                      </div>
                    </div>
                    {members.length > 1 && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => removeMember(index)}>
                        移除
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Label htmlFor="payment_screenshot">上传缴费截图（全部顾客共用一张，一次付款）</Label>
                <Input id="payment_screenshot" name="payment_screenshot" type="file" accept="image/*,.pdf" required />
                <p className="text-xs text-muted-foreground">上传后订单会先是「待处理」，等后台核实截图后才会生效并计算佣金。</p>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="customer_id">顾客</Label>
                {/* Base UI's Select.Value shows the raw value unless Root gets an
                    `items` map — see the same note in register-form.tsx. */}
                <Select
                  name="customer_id"
                  items={customers.map((c) => ({ value: c.id, label: c.name }))}
                  value={voucherCustomerId}
                  onValueChange={(v) => setVoucherCustomerId(v ?? "")}
                  required
                >
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="amount">顾客实付金额 (RM)</Label>
                <Input
                  id="amount"
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={voucherAmount}
                  onChange={(e) => setVoucherAmount(e.target.value)}
                  required
                />
              </div>
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
            </>
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
