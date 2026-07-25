"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ct } from "@/lib/i18n-client";
import { createInstitutionalOrder, type CreateInstitutionalOrderState } from "./actions";
import type { InstitutionOption } from "./data";

const initialState: CreateInstitutionalOrderState = { status: "idle" };

export function CreateInstitutionalOrderForm({
  agents,
  institutions,
}: {
  agents: { id: string; name: string }[];
  institutions: InstitutionOption[];
}) {
  const [state, formAction, isPending] = useActionState(createInstitutionalOrder, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  // Reusing an already-billed institution (from a prior order OR a PIC
  // channel campaign, migration 043) skips retyping SSM/address; "new"
  // keeps today's freeform entry. Defaults to "new" when there's simply
  // nothing to pick yet.
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
          <div className="space-y-2">
            <Label htmlFor="description">{ct("finance.institutional.new_order.description_label")}</Label>
            <Input id="description" name="description" required />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="total_amount">{ct("finance.institutional.new_order.amount_label")}</Label>
              <Input id="total_amount" name="total_amount" type="number" step="0.01" min="0.01" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quantity">{ct("finance.institutional.new_order.quantity_label")}</Label>
              <Input id="quantity" name="quantity" type="number" step="1" min="1" defaultValue="1" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="analyst_id">{ct("finance.institutional.new_order.analyst_label")}</Label>
              <Select name="analyst_id" items={agents.map((a) => ({ value: a.id, label: a.name }))}>
                <SelectTrigger id="analyst_id" className="w-full">
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
          {state.status === "success" && <p className="text-sm">{ct("finance.institutional.new_order.success")}</p>}

          <Button type="submit" disabled={isPending || (mode === "existing" && !institutionPartyId)}>
            {ct("finance.institutional.new_order.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
