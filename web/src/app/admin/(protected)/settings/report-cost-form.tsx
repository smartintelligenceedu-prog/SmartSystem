"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ct } from "@/lib/i18n-client";
import { updateReportCostSettings, type UpdateReportCostState } from "./actions";
import { submitWithoutReset } from "@/lib/submit-without-reset";
import type { ReportCostSettings } from "./data";

const initialState: UpdateReportCostState = { status: "idle" };

export function ReportCostForm({ reportCost }: { reportCost: ReportCostSettings }) {
  const [state, formAction, isPending] = useActionState(updateReportCostSettings, initialState);

  return (
    <form onSubmit={submitWithoutReset(formAction)} className="max-w-sm space-y-4">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{ct("settings.report_cost.standard_label")}</label>
        <Input name="standardCost" type="number" step="0.01" min="0" defaultValue={reportCost.standardCost} required />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{ct("settings.report_cost.upgrade_label")}</label>
        <Input name="upgradeCost" type="number" step="0.01" min="0" defaultValue={reportCost.upgradeCost} required />
      </div>

      {state.status === "error" && (
        <p className="text-xs text-destructive" role="alert">
          {state.message}
        </p>
      )}
      {state.status === "success" && <p className="text-xs text-emerald-600">{ct("settings.report_cost.save_success")}</p>}

      <Button type="submit" disabled={isPending}>
        {isPending ? ct("settings.report_cost.saving") : ct("settings.report_cost.save")}
      </Button>
    </form>
  );
}
