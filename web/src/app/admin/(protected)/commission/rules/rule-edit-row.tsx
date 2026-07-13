"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { updateCommissionRule, type UpdateCommissionRuleState } from "./actions";
import type { CommissionRuleRow } from "./data";

const initialState: UpdateCommissionRuleState = { status: "idle" };

const TRIGGER_LABEL: Record<string, string> = {
  personal_sale: "个人销售",
  pic_channel: "通路销售（PIC）",
  introducer: "引荐人佣金",
  recruitment: "招募佣金",
  voucher_resale: "兑换券转售",
};

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

export function RuleEditRow({ rule }: { rule: CommissionRuleRow }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(updateCommissionRule, initialState);
  const [editing, setEditing] = useState(false);
  const [calcType, setCalcType] = useState<"percentage" | "flat">(rule.calculation_type);

  useEffect(() => {
    if (state.status === "success") {
      setEditing(false);
      router.refresh();
    }
  }, [state, router]);

  const label = rule.level_number > 0 ? `${TRIGGER_LABEL[rule.trigger_type] ?? rule.trigger_type} · Level ${rule.level_number}` : TRIGGER_LABEL[rule.trigger_type] ?? rule.trigger_type;

  if (!editing) {
    return (
      <div className="flex items-center justify-between px-4 py-3 text-sm">
        <div>
          <p>{label}</p>
          <p className="text-xs text-muted-foreground">生效日期：{new Date(rule.effective_from).toLocaleDateString("zh-CN")}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">
            {rule.calculation_type === "flat" ? formatMYR(rule.flat_amount ?? 0) : `${rule.rate_percent}%`}
          </Badge>
          {rule.cap_amount !== null && <span className="text-xs text-muted-foreground">上限 {formatMYR(rule.cap_amount)}</span>}
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            调整
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 py-3 text-sm">
      <p className="font-medium">{label}</p>
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="trigger_type" value={rule.trigger_type} />
        <input type="hidden" name="level_number" value={rule.level_number} />
        <input type="hidden" name="calculation_type" value={calcType} />

        <div className="flex gap-2">
          <Button type="button" size="sm" variant={calcType === "percentage" ? "default" : "outline"} onClick={() => setCalcType("percentage")}>
            按百分比
          </Button>
          <Button type="button" size="sm" variant={calcType === "flat" ? "default" : "outline"} onClick={() => setCalcType("flat")}>
            固定金额
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {calcType === "percentage" ? (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">费率 (%)</label>
              <Input name="rate_percent" type="number" step="0.01" min="0" max="100" defaultValue={rule.rate_percent ?? undefined} required />
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">固定金额 (RM)</label>
              <Input name="flat_amount" type="number" step="0.01" min="0" defaultValue={rule.flat_amount ?? undefined} required />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">上限（选填）</label>
            <Input name="cap_amount" type="number" step="0.01" min="0" defaultValue={rule.cap_amount ?? undefined} />
          </div>
        </div>

        {state.status === "error" && (
          <p className="text-xs text-destructive" role="alert">
            {state.message}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "储存中…" : "储存"}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setEditing(false)}>
            取消
          </Button>
        </div>
      </form>
    </div>
  );
}
