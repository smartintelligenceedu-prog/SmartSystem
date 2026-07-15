"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createSalesOrder, type CreateSalesOrderState } from "../actions";
import type { SalesItemRow } from "../data";

const initialState: CreateSalesOrderState = { status: "idle" };

interface ItemLine {
  item_id: string;
  amount: string;
}

interface Member {
  customer_id: string;
  analyst_id: string;
  lines: ItemLine[];
}

function emptyLine(): ItemLine {
  return { item_id: "", amount: "" };
}

export function NewSalesOrderForm({
  ownAnalystId,
  ownAnalystName,
  customers,
  agents,
  vouchers,
  salesItems,
}: {
  ownAnalystId: string;
  ownAnalystName: string;
  customers: { id: string; name: string }[];
  agents: { id: string; name: string }[];
  vouchers: { id: string; label: string }[];
  salesItems: SalesItemRow[];
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(createSalesOrder, initialState);
  const [mode, setMode] = useState<"pay_now" | "redeem_voucher">("pay_now");
  const [members, setMembers] = useState<Member[]>([{ customer_id: "", analyst_id: ownAnalystId, lines: [emptyLine()] }]);

  // redeem_voucher mode keeps the original single-person fields.
  const [voucherCustomerId, setVoucherCustomerId] = useState("");
  const [voucherAmount, setVoucherAmount] = useState("");

  useEffect(() => {
    if (state.status === "success") {
      router.push("/admin/sales-orders");
    }
  }, [state, router]);

  function addMember() {
    setMembers((prev) => [...prev, { customer_id: "", analyst_id: ownAnalystId, lines: [emptyLine()] }]);
  }
  function removeMember(index: number) {
    setMembers((prev) => prev.filter((_, i) => i !== index));
  }
  function updateMember(index: number, field: "customer_id" | "analyst_id", value: string) {
    setMembers((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
  }
  function addLine(memberIndex: number) {
    setMembers((prev) => prev.map((m, i) => (i === memberIndex ? { ...m, lines: [...m.lines, emptyLine()] } : m)));
  }
  function removeLine(memberIndex: number, lineIndex: number) {
    setMembers((prev) => prev.map((m, i) => (i === memberIndex ? { ...m, lines: m.lines.filter((_, li) => li !== lineIndex) } : m)));
  }
  // Selecting an item pre-fills the amount from its catalog price — the
  // amount stays a plain editable field afterward (the CTO's choice), so
  // staff can still record what was actually received (a discount, a
  // rounded cash amount, etc.).
  function updateLineItem(memberIndex: number, lineIndex: number, itemId: string) {
    const item = salesItems.find((si) => si.id === itemId);
    setMembers((prev) =>
      prev.map((m, i) =>
        i !== memberIndex
          ? m
          : {
              ...m,
              lines: m.lines.map((l, li) => (li === lineIndex ? { item_id: itemId, amount: item ? String(item.price) : l.amount } : l)),
            }
      )
    );
  }
  function updateLineAmount(memberIndex: number, lineIndex: number, amount: string) {
    setMembers((prev) =>
      prev.map((m, i) => (i !== memberIndex ? m : { ...m, lines: m.lines.map((l, li) => (li === lineIndex ? { ...l, amount } : l)) }))
    );
  }

  const agentOptions = agents.length > 0 ? agents : [{ id: ownAnalystId, name: ownAnalystName }];
  const itemOptions = salesItems.map((si) => ({
    value: si.id,
    label: si.item_kind === "discount" ? `${si.name}（折扣） RM ${si.price}` : `${si.name} RM ${si.price}`,
  }));

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
              {salesItems.length === 0 && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                  还没有设定任何销售项目，请先请后台去{" "}
                  <Link href="/admin/sales-orders/items" className="underline">
                    价目表
                  </Link>{" "}
                  建立项目才能选择。
                </p>
              )}
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

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">销售项目</Label>
                        <Button type="button" size="sm" variant="ghost" onClick={() => addLine(index)}>
                          加一行（例如折扣）
                        </Button>
                      </div>
                      {member.lines.map((line, lineIndex) => (
                        <div key={lineIndex} className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
                          <div className="space-y-1">
                            <Select
                              items={itemOptions}
                              value={line.item_id}
                              onValueChange={(v) => updateLineItem(index, lineIndex, v ?? "")}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="请选择项目" />
                              </SelectTrigger>
                              <SelectContent>
                                {itemOptions.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Input
                              type="number"
                              step="0.01"
                              className="w-28"
                              placeholder="金额 (RM)"
                              value={line.amount}
                              onChange={(e) => updateLineAmount(index, lineIndex, e.target.value)}
                            />
                          </div>
                          {member.lines.length > 1 && (
                            <Button type="button" size="sm" variant="ghost" onClick={() => removeLine(index, lineIndex)}>
                              移除
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>

                    {members.length > 1 && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => removeMember(index)}>
                        移除这位顾客
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
