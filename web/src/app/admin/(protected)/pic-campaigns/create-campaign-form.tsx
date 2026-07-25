"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ct } from "@/lib/i18n-client";
import { createCampaign, type CreateCampaignState } from "./actions";
import type { AnalystOption } from "./data";
import type { InstitutionOption } from "../finance/institutional/data";

const initialState: CreateCampaignState = { status: "idle" };

const CAMPAIGN_TYPES = [
  { value: "school", labelKey: "pic_campaigns.type.school" },
  { value: "institution", labelKey: "pic_campaigns.type.institution" },
  { value: "roadshow", labelKey: "pic_campaigns.type.roadshow" },
  { value: "other", labelKey: "pic_campaigns.type.other" },
] as const;

export function CreateCampaignForm({ analysts, institutions }: { analysts: AnalystOption[]; institutions: InstitutionOption[] }) {
  const [state, formAction, isPending] = useActionState(createCampaign, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  // A campaign isn't always tied to a formal billing entity (e.g. a public
  // mall roadshow) — unlike Institutional Orders, "none" is a real option
  // here, not just a fallback while the list is empty.
  const [institutionMode, setInstitutionMode] = useState<"none" | "existing" | "new">("none");
  const [institutionPartyId, setInstitutionPartyId] = useState<string | null>(null);
  const selectedInstitution = institutions.find((i) => i.party_id === institutionPartyId);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      setInstitutionMode("none");
      setInstitutionPartyId(null);
    }
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

          <div className="border-t pt-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {ct("pic_campaigns.form.institution_section")}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={institutionMode === "none" ? "default" : "outline"}
                  onClick={() => setInstitutionMode("none")}
                  disabled={isPending}
                >
                  {ct("pic_campaigns.form.institution_mode_none")}
                </Button>
                {institutions.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant={institutionMode === "existing" ? "default" : "outline"}
                    onClick={() => setInstitutionMode("existing")}
                    disabled={isPending}
                  >
                    {ct("finance.institutional.new_order.institution_mode_existing")}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant={institutionMode === "new" ? "default" : "outline"}
                  onClick={() => setInstitutionMode("new")}
                  disabled={isPending}
                >
                  {ct("finance.institutional.new_order.institution_mode_new")}
                </Button>
              </div>
            </div>

            {institutionMode === "none" && <p className="text-sm text-muted-foreground">{ct("pic_campaigns.form.institution_none_hint")}</p>}

            {institutionMode === "existing" && (
              <div className="space-y-2">
                <Label htmlFor="institution_select">{ct("finance.institutional.new_order.institution_select_label")}</Label>
                <Select
                  items={institutions.map((i) => ({ value: i.party_id, label: i.legal_name }))}
                  value={institutionPartyId ?? undefined}
                  onValueChange={(v) => setInstitutionPartyId(v as string)}
                >
                  <SelectTrigger id="institution_select" className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {institutions.map((i) => (
                      <SelectItem key={i.party_id} value={i.party_id}>
                        {i.legal_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedInstitution && (
                  <p className="text-xs text-muted-foreground">
                    {[selectedInstitution.ssm_number, selectedInstitution.address_line1, selectedInstitution.city].filter(Boolean).join(" · ")}
                  </p>
                )}
                <input type="hidden" name="institution_party_id" value={institutionPartyId ?? ""} />
              </div>
            )}

            {institutionMode === "new" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="institution_name">{ct("finance.institutional.new_order.institution_name_label")}</Label>
                    <Input id="institution_name" name="institution_name" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ssm_number">{ct("finance.institutional.new_order.ssm_number_label")}</Label>
                    <Input id="ssm_number" name="ssm_number" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="billing_address_line1">{ct("finance.institutional.new_order.billing_address_label")}</Label>
                  <Input id="billing_address_line1" name="billing_address_line1" placeholder={ct("finance.institutional.new_order.address_line1_placeholder")} required />
                  <Input id="billing_address_line2" name="billing_address_line2" placeholder={ct("finance.institutional.new_order.address_line2_placeholder")} />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="billing_city">{ct("finance.institutional.new_order.city_label")}</Label>
                    <Input id="billing_city" name="billing_city" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="billing_state">{ct("finance.institutional.new_order.state_label")}</Label>
                    <Input id="billing_state" name="billing_state" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="billing_postcode">{ct("finance.institutional.new_order.postcode_label")}</Label>
                    <Input id="billing_postcode" name="billing_postcode" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="institution_phone">{ct("finance.institutional.new_order.institution_phone_label")}</Label>
                  <Input id="institution_phone" name="institution_phone" />
                </div>
              </div>
            )}
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "success" && <p className="text-sm">{ct("pic_campaigns.form.success")}</p>}

          <Button type="submit" disabled={isPending || (institutionMode === "existing" && !institutionPartyId)}>
            {ct("pic_campaigns.form.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
