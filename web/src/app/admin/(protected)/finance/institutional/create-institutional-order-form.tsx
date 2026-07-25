"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ct } from "@/lib/i18n-client";
import { createInstitutionalOrder, type CreateInstitutionalOrderState } from "./actions";
import type { InstitutionOption, PackageOption } from "./data";

const initialState: CreateInstitutionalOrderState = { status: "idle" };
const NO_PACKAGE = "__none__";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

export function CreateInstitutionalOrderForm({
  agents,
  institutions,
  packages,
}: {
  agents: { id: string; name: string }[];
  institutions: InstitutionOption[];
  packages: PackageOption[];
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

  // When this batch counts against a negotiated bulk package (migration
  // 044), the package's own institution is authoritative and its unit
  // price is prefilled — the whole institution section below is hidden
  // since there's nothing left to pick or type.
  const [packageId, setPackageId] = useState<string>(NO_PACKAGE);
  const selectedPackage = packages.find((p) => p.id === packageId);

  // One order item per name on this list — a shared item/price billed once
  // per test-taker, matching the business's existing external invoice
  // format ("Ditoso 150 Package ( Taner )") so the institution can check
  // names against the invoice. A blank name is fine (bulk line with no
  // individual breakdown); at least one row is always required.
  const [studentNames, setStudentNames] = useState<string[]>([""]);
  const [unitPrice, setUnitPrice] = useState("");
  const total = (Number(unitPrice) || 0) * studentNames.length;

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      setInstitutionPartyId(null);
      setPackageId(NO_PACKAGE);
      setStudentNames([""]);
      setUnitPrice("");
    }
  }, [state]);

  return (
    <Card>
      <CardContent className="pt-6">
        <form ref={formRef} action={formAction} className="space-y-4">
          {packages.length > 0 && (
            <div className="space-y-2 border-b pb-4">
              <Label htmlFor="package_select">{ct("finance.institutional.new_order.package_select_label")}</Label>
              <Select
                items={[
                  { value: NO_PACKAGE, label: ct("finance.institutional.new_order.package_none_option") },
                  ...packages.map((p) => ({ value: p.id, label: `${p.institution_name} · ${p.name}` })),
                ]}
                value={packageId}
                onValueChange={(v) => {
                  const id = v as string;
                  setPackageId(id);
                  const pkg = packages.find((p) => p.id === id);
                  if (pkg) setUnitPrice(String(pkg.unit_price));
                }}
              >
                <SelectTrigger id="package_select" className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PACKAGE}>{ct("finance.institutional.new_order.package_none_option")}</SelectItem>
                  {packages.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.institution_name} · {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPackage && (
                <p className="text-xs text-muted-foreground">
                  {ct("finance.institutional.new_order.package_remaining_prefix")}
                  {selectedPackage.total_credits - selectedPackage.used_credits}/{selectedPackage.total_credits}
                </p>
              )}
              <input type="hidden" name="institutional_package_id" value={packageId === NO_PACKAGE ? "" : packageId} />
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="item_name">{ct("finance.institutional.new_order.item_name_label")}</Label>
              <Input id="item_name" name="item_name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit_price">{ct("finance.institutional.new_order.unit_price_label")}</Label>
              <Input
                id="unit_price"
                name="unit_price"
                type="number"
                step="0.01"
                min="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                required
              />
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
              <Label>{ct("finance.institutional.new_order.student_names_label")}</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setStudentNames((prev) => [...prev, ""])}
                disabled={isPending}
              >
                {ct("finance.institutional.new_order.add_student_button")}
              </Button>
            </div>
            <div className="space-y-2">
              {studentNames.map((name, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    name="student_name"
                    value={name}
                    onChange={(e) =>
                      setStudentNames((prev) => prev.map((n, idx) => (idx === i ? e.target.value : n)))
                    }
                    placeholder={ct("finance.institutional.new_order.student_name_placeholder")}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setStudentNames((prev) => prev.filter((_, idx) => idx !== i))}
                    disabled={isPending || studentNames.length <= 1}
                  >
                    {ct("finance.institutional.new_order.remove_student_button")}
                  </Button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {ct("finance.institutional.new_order.total_prefix")}
              {studentNames.length}
              {ct("finance.institutional.new_order.total_middle")}
              {formatMYR(total)}
            </p>
          </div>

          {packageId === NO_PACKAGE && (
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
          )}

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "success" && <p className="text-sm">{ct("finance.institutional.new_order.success")}</p>}

          <Button
            type="submit"
            disabled={isPending || (packageId === NO_PACKAGE && mode === "existing" && !institutionPartyId)}
          >
            {ct("finance.institutional.new_order.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
