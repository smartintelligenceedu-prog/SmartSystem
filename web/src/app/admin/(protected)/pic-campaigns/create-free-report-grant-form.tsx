"use client";

import { useActionState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ct } from "@/lib/i18n-client";
import { recordFreeReportGrant, type RecordFreeReportGrantState } from "./actions";
import { submitWithoutReset } from "@/lib/submit-without-reset";
import type { CampaignRow } from "./data";

const initialState: RecordFreeReportGrantState = { status: "idle" };

const REPORT_TIERS = [
  { value: "standard", labelKey: "pic_campaigns.free_reports.tier_standard" as const },
  { value: "upgrade", labelKey: "pic_campaigns.free_reports.tier_upgrade" as const },
];

// Direct-entry ledger posting (no review queue), same shape as
// RecordExpenseForm in finance/ — see recordFreeReportGrant()'s header
// comment for why this posts to 6200 instead of going through orders.
export function CreateFreeReportGrantForm({ campaigns }: { campaigns: CampaignRow[] }) {
  const [state, formAction, isPending] = useActionState(recordFreeReportGrant, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <Card>
      <CardContent className="pt-6">
        <form ref={formRef} onSubmit={submitWithoutReset(formAction)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 sm:col-span-1">
              <Label htmlFor="free_report_campaign_id">{ct("pic_campaigns.free_reports.campaign_label")}</Label>
              <Select name="campaign_id" items={campaigns.map((c) => ({ value: c.id, label: c.name }))}>
                <SelectTrigger id="free_report_campaign_id" className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} · {c.pic_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="recipient_name">{ct("pic_campaigns.free_reports.recipient_label")}</Label>
              <Input id="recipient_name" name="recipient_name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="report_tier">{ct("pic_campaigns.free_reports.tier_label")}</Label>
              <Select name="report_tier" items={REPORT_TIERS.map((r) => ({ value: r.value, label: ct(r.labelKey) }))} defaultValue="standard">
                <SelectTrigger id="report_tier" className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_TIERS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {ct(r.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="notes">{ct("pic_campaigns.free_reports.notes_label")}</Label>
              <Input id="notes" name="notes" placeholder={ct("pic_campaigns.free_reports.notes_placeholder")} />
            </div>
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "success" && <p className="text-sm">{ct("pic_campaigns.free_reports.success")}</p>}

          <Button type="submit" disabled={isPending || campaigns.length === 0}>
            {ct("pic_campaigns.free_reports.submit")}
          </Button>
          {campaigns.length === 0 && <p className="text-xs text-muted-foreground">{ct("pic_campaigns.free_reports.no_campaigns")}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
