"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { updateCommissionRule, type UpdateCommissionRuleState } from "./actions";
import type { CommissionRuleRow } from "./data";
import { ct } from "@/lib/i18n-client";
import type { TranslationKey } from "@/lib/i18n-shared";

const initialState: UpdateCommissionRuleState = { status: "idle" };

const TRIGGER_KEY = {
  personal_sale: "payroll.trigger_type.personal_sale",
  pic_channel: "payroll.trigger_type.pic_channel",
  introducer: "payroll.trigger_type.introducer",
  recruitment: "payroll.trigger_type.recruitment",
  voucher_resale: "payroll.trigger_type.voucher_resale",
  report_override: "payroll.trigger_type.report_override",
  analyst_report_fee: "payroll.trigger_type.analyst_report_fee",
} satisfies Record<string, TranslationKey>;

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

  const triggerLabel = rule.trigger_type in TRIGGER_KEY ? ct(TRIGGER_KEY[rule.trigger_type as keyof typeof TRIGGER_KEY]) : rule.trigger_type;
  const label = rule.level_number > 0 ? `${triggerLabel} · Level ${rule.level_number}` : triggerLabel;

  if (!editing) {
    return (
      <div className="flex items-center justify-between px-4 py-3 text-sm">
        <div>
          <p>{label}</p>
          <p className="text-xs text-muted-foreground">
            {ct("commission.rules.row.effective_date_prefix")}
            {new Date(rule.effective_from).toLocaleDateString("zh-CN")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">
            {rule.calculation_type === "flat" ? formatMYR(rule.flat_amount ?? 0) : `${rule.rate_percent}%`}
          </Badge>
          {rule.cap_amount !== null && (
            <span className="text-xs text-muted-foreground">
              {ct("commission.rules.row.cap_prefix")}
              {formatMYR(rule.cap_amount)}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {ct("commission.rules.row.adjust")}
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
            {ct("commission.rules.row.by_percentage")}
          </Button>
          <Button type="button" size="sm" variant={calcType === "flat" ? "default" : "outline"} onClick={() => setCalcType("flat")}>
            {ct("commission.rules.row.flat_amount")}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {calcType === "percentage" ? (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{ct("commission.rules.row.rate_label")}</label>
              <Input name="rate_percent" type="number" step="0.01" min="0" max="100" defaultValue={rule.rate_percent ?? undefined} required />
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{ct("commission.rules.row.flat_amount_label")}</label>
              <Input name="flat_amount" type="number" step="0.01" min="0" defaultValue={rule.flat_amount ?? undefined} required />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{ct("commission.rules.row.cap_label")}</label>
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
            {isPending ? ct("commission.rules.row.saving") : ct("commission.rules.row.save")}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setEditing(false)}>
            {ct("commission.rules.row.cancel")}
          </Button>
        </div>
      </form>
    </div>
  );
}
