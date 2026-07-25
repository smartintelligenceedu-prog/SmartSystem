"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ct } from "@/lib/i18n-client";
import type { InstitutionOption } from "../finance/institutional/data";

// Shared "none / existing / new" institution-billing-identity picker, used
// by both CreateCampaignForm and EditCampaignInstitutionForm — factored out
// since the existing/new toggle and its fields are identical in both,
// only "none" (valid for a campaign, not for an Institutional Order) is
// campaign-specific.
export function InstitutionPickerFields({
  institutions,
  mode,
  setMode,
  institutionPartyId,
  setInstitutionPartyId,
  isPending,
}: {
  institutions: InstitutionOption[];
  mode: "none" | "existing" | "new";
  setMode: (mode: "none" | "existing" | "new") => void;
  institutionPartyId: string | null;
  setInstitutionPartyId: (id: string | null) => void;
  isPending: boolean;
}) {
  const selectedInstitution = institutions.find((i) => i.party_id === institutionPartyId);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("pic_campaigns.form.institution_section")}</p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant={mode === "none" ? "default" : "outline"} onClick={() => setMode("none")} disabled={isPending}>
            {ct("pic_campaigns.form.institution_mode_none")}
          </Button>
          {institutions.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant={mode === "existing" ? "default" : "outline"}
              onClick={() => setMode("existing")}
              disabled={isPending}
            >
              {ct("finance.institutional.new_order.institution_mode_existing")}
            </Button>
          )}
          <Button type="button" size="sm" variant={mode === "new" ? "default" : "outline"} onClick={() => setMode("new")} disabled={isPending}>
            {ct("finance.institutional.new_order.institution_mode_new")}
          </Button>
        </div>
      </div>

      {mode === "none" && <p className="text-sm text-muted-foreground">{ct("pic_campaigns.form.institution_none_hint")}</p>}

      {mode === "existing" && (
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

      {mode === "new" && (
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
            <Input
              id="billing_address_line1"
              name="billing_address_line1"
              placeholder={ct("finance.institutional.new_order.address_line1_placeholder")}
              required
            />
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
  );
}
