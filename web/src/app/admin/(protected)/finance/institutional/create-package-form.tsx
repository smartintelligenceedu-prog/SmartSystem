"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ct } from "@/lib/i18n-client";
import { createInstitutionalPackage, type CreatePackageState } from "./actions";
import type { InstitutionOption } from "./data";

const initialState: CreatePackageState = { status: "idle" };

export function CreatePackageForm({
  institutions,
  agents,
}: {
  institutions: InstitutionOption[];
  agents: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(createInstitutionalPackage, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<"existing" | "new">(institutions.length > 0 ? "existing" : "new");
  const [institutionPartyId, setInstitutionPartyId] = useState<string | null>(null);
  const selectedInstitution = institutions.find((i) => i.party_id === institutionPartyId);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      setInstitutionPartyId(null);
    }
  }, [state]);

  return (
    <Card>
      <CardContent className="pt-6">
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pkg_name">{ct("finance.institutional.package.name_label")}</Label>
              <Input id="pkg_name" name="name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pkg_total_credits">{ct("finance.institutional.package.total_credits_label")}</Label>
              <Input id="pkg_total_credits" name="total_credits" type="number" step="1" min="1" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pkg_unit_price">{ct("finance.institutional.package.unit_price_label")}</Label>
              <Input id="pkg_unit_price" name="unit_price" type="number" step="0.01" min="0.01" required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pkg_deposit_amount">{ct("finance.institutional.package.deposit_label")}</Label>
            <Input id="pkg_deposit_amount" name="deposit_amount" type="number" step="0.01" min="0" placeholder={ct("finance.institutional.package.deposit_placeholder")} />
            <p className="text-xs text-muted-foreground">{ct("finance.institutional.package.deposit_hint")}</p>
          </div>

          <div className="border-t pt-4">
            <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {ct("finance.institutional.package.commission_section")}
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pkg_responsible_analyst_id">{ct("finance.institutional.package.responsible_analyst_label")}</Label>
                <Select name="responsible_analyst_id" items={agents.map((a) => ({ value: a.id, label: a.name }))}>
                  <SelectTrigger id="pkg_responsible_analyst_id" className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pkg_report_override_amount">{ct("finance.institutional.package.report_override_label")}</Label>
                <Input
                  id="pkg_report_override_amount"
                  name="report_override_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={ct("finance.institutional.package.commission_placeholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pkg_analyst_report_fee_amount">{ct("finance.institutional.package.analyst_fee_label")}</Label>
                <Input
                  id="pkg_analyst_report_fee_amount"
                  name="analyst_report_fee_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={ct("finance.institutional.package.commission_placeholder")}
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{ct("finance.institutional.package.commission_hint")}</p>
          </div>

          <div className="border-t pt-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {ct("finance.institutional.new_order.billing_entity_section")}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "existing" ? "default" : "outline"}
                  onClick={() => setMode("existing")}
                  disabled={isPending}
                >
                  {ct("finance.institutional.new_order.institution_mode_existing")}
                </Button>
                <Button type="button" size="sm" variant={mode === "new" ? "default" : "outline"} onClick={() => setMode("new")} disabled={isPending}>
                  {ct("finance.institutional.new_order.institution_mode_new")}
                </Button>
              </div>
            </div>

            {mode === "existing" ? (
              institutions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{ct("finance.institutional.new_order.no_institutions")}</p>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="pkg_institution_select">{ct("finance.institutional.new_order.institution_select_label")}</Label>
                  <Select
                    items={institutions.map((i) => ({ value: i.party_id, label: i.legal_name }))}
                    value={institutionPartyId ?? undefined}
                    onValueChange={(v) => setInstitutionPartyId(v as string)}
                  >
                    <SelectTrigger id="pkg_institution_select" className="w-full">
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
                      {[selectedInstitution.ssm_number, selectedInstitution.address_line1, selectedInstitution.city]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  <input type="hidden" name="institution_party_id" value={institutionPartyId ?? ""} />
                </div>
              )
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="pkg_institution_name">{ct("finance.institutional.new_order.institution_name_label")}</Label>
                    <Input id="pkg_institution_name" name="institution_name" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pkg_ssm_number">{ct("finance.institutional.new_order.ssm_number_label")}</Label>
                    <Input id="pkg_ssm_number" name="ssm_number" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pkg_billing_address_line1">{ct("finance.institutional.new_order.billing_address_label")}</Label>
                  <Input
                    id="pkg_billing_address_line1"
                    name="billing_address_line1"
                    placeholder={ct("finance.institutional.new_order.address_line1_placeholder")}
                    required
                  />
                  <Input id="pkg_billing_address_line2" name="billing_address_line2" placeholder={ct("finance.institutional.new_order.address_line2_placeholder")} />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="pkg_billing_city">{ct("finance.institutional.new_order.city_label")}</Label>
                    <Input id="pkg_billing_city" name="billing_city" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pkg_billing_state">{ct("finance.institutional.new_order.state_label")}</Label>
                    <Input id="pkg_billing_state" name="billing_state" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pkg_billing_postcode">{ct("finance.institutional.new_order.postcode_label")}</Label>
                    <Input id="pkg_billing_postcode" name="billing_postcode" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pkg_institution_phone">{ct("finance.institutional.new_order.institution_phone_label")}</Label>
                  <Input id="pkg_institution_phone" name="institution_phone" />
                </div>
              </div>
            )}
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "success" && <p className="text-sm">{ct("finance.institutional.package.success")}</p>}

          <Button type="submit" disabled={isPending || (mode === "existing" && !institutionPartyId)}>
            {ct("finance.institutional.package.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
