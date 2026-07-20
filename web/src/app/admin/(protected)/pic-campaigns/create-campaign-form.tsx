"use client";

import { useActionState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ct } from "@/lib/i18n-client";
import { createCampaign, type CreateCampaignState } from "./actions";
import type { AnalystOption } from "./data";

const initialState: CreateCampaignState = { status: "idle" };

const CAMPAIGN_TYPES = [
  { value: "school", labelKey: "pic_campaigns.type.school" },
  { value: "institution", labelKey: "pic_campaigns.type.institution" },
  { value: "roadshow", labelKey: "pic_campaigns.type.roadshow" },
  { value: "other", labelKey: "pic_campaigns.type.other" },
] as const;

export function CreateCampaignForm({ analysts }: { analysts: AnalystOption[] }) {
  const [state, formAction, isPending] = useActionState(createCampaign, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <Card>
      <CardContent className="pt-6">
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">{ct("pic_campaigns.form.name_label")}</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="campaign_type">{ct("pic_campaigns.form.type_label")}</Label>
              <Select
                name="campaign_type"
                items={CAMPAIGN_TYPES.map((campaignType) => ({ value: campaignType.value, label: ct(campaignType.labelKey) }))}
                defaultValue="school"
              >
                <SelectTrigger id="campaign_type" className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {CAMPAIGN_TYPES.map((campaignType) => (
                    <SelectItem key={campaignType.value} value={campaignType.value}>
                      {ct(campaignType.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pic_analyst_id">{ct("pic_campaigns.form.pic_label")}</Label>
              <Select name="pic_analyst_id" items={analysts.map((a) => ({ value: a.id, label: a.name }))}>
                <SelectTrigger id="pic_analyst_id" className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {analysts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">{ct("pic_campaigns.form.location_label")}</Label>
              <Input id="location" name="location" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pic_report_override_amount">{ct("pic_campaigns.form.report_override_label")}</Label>
              <Input id="pic_report_override_amount" name="pic_report_override_amount" type="number" step="0.01" min="0" placeholder={ct("pic_campaigns.form.fallback_placeholder")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pic_analyst_report_fee_amount">{ct("pic_campaigns.form.analyst_fee_label")}</Label>
              <Input
                id="pic_analyst_report_fee_amount"
                name="pic_analyst_report_fee_amount"
                type="number"
                step="0.01"
                min="0"
                placeholder={ct("pic_campaigns.form.fallback_placeholder")}
              />
            </div>
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "success" && <p className="text-sm">{ct("pic_campaigns.form.success")}</p>}

          <Button type="submit" disabled={isPending}>
            {ct("pic_campaigns.form.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
