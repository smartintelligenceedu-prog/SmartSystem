"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox, ComboboxInputGroup, ComboboxInput, ComboboxButtonGroup, ComboboxClear, ComboboxTrigger, ComboboxContent, ComboboxItem } from "@/components/ui/combobox";
import { ct } from "@/lib/i18n-client";
import { createInstitutionalOrder, type CreateInstitutionalOrderState } from "./actions";
import { submitWithoutReset } from "@/lib/submit-without-reset";
import type { InstitutionOption, PackageOption } from "./data";

const initialState: CreateInstitutionalOrderState = { status: "idle" };
const NO_PACKAGE = "__none__";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

interface StudentRow {
  name: string;
  analystId: string;
}

function emptyRow(defaultAnalystId = ""): StudentRow {
  return { name: "", analystId: defaultAnalystId };
}

export function CreateInstitutionalOrderForm({
  agents,
  institutions,
  packages,
  customers,
}: {
  agents: { id: string; name: string }[];
  institutions: InstitutionOption[];
  packages: PackageOption[];
  customers: { id: string; name: string; owner_analyst_id: string | null }[];
}) {
  const [state, formAction, isPending] = useActionState(createInstitutionalOrder, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  // Who this order is billed to — a formal institution (schools/companies,
  // the original use case) or a real registered individual customer paying
  // their own deposit/final invoice (Business & CRM). Mutually exclusive —
  // see createInstitutionalOrder's schema refine.
  const [billingPartyType, setBillingPartyType] = useState<"institution" | "customer">("institution");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const customerOptions = customers.map((c) => ({ value: c.id, label: c.name }));
  const isCustomerOptionEqual = (a: { value: string }, b: { value: string }) => a.value === b.value;
  // Picking the customer already tells us who the responsible analyst is
  // (their own owner_analyst_id) — default any row that hasn't been given
  // its own analyst yet, rather than leaving it blank. Left blank, that row's
  // order_item.analyst_id stays null forever, which silently hides the whole
  // line from every analyst-scoped view (their own dashboard, their own
  // Sales Orders list, the commission engine) even after it's fully paid.
  // Never overwrites a row the user already set by hand.
  function selectCustomer(id: string | null) {
    setCustomerId(id);
    const customer = customers.find((c) => c.id === id);
    if (!customer?.owner_analyst_id) return;
    setRows((prev) => prev.map((r) => (r.analystId ? r : { ...r, analystId: customer.owner_analyst_id! })));
  }
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

  // One order item per row — a shared item/price billed once per
  // test-taker, matching the business's existing external invoice format
  // ("Ditoso 150 Package ( Taner )") so the institution can check names
  // against the invoice. Each row also picks its OWN interpreting analyst
  // (independent of the package's fixed "responsible analyst", who gets a
  // separate override regardless of who's picked here) — a batch commonly
  // has different agents each interpreting different students' reports,
  // and analyst_report_fee is paid per order_item's own analyst_id.
  const [rows, setRows] = useState<StudentRow[]>([emptyRow()]);
  const [unitPrice, setUnitPrice] = useState("");
  const total = (Number(unitPrice) || 0) * rows.length;

  // Quick-fill shortcut for the common case of one big batch all handled by
  // the same analyst — replaces manually clicking "add" N times. Still
  // generates one order_item row per test-taker underneath (names blank,
  // same analyst_id) rather than a single quantity=N row, since commission
  // and per-report delivery tracking both key off individual order_items.
  const [bulkQuantity, setBulkQuantity] = useState("");
  const [bulkAnalystId, setBulkAnalystId] = useState("");

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      setInstitutionPartyId(null);
      setCustomerId(null);
      setPackageId(NO_PACKAGE);
      setRows([emptyRow()]);
      setUnitPrice("");
      setBulkQuantity("");
      setBulkAnalystId("");
    }
  }, [state]);

  return (
    <Card>
      <CardContent className="pt-6">
        <form ref={formRef} onSubmit={submitWithoutReset(formAction)} className="space-y-4">
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

          <div className="grid grid-cols-2 gap-4">
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
          </div>

          <div className="border-t pt-4">
            <div className="mb-3 flex items-center justify-between">
              <Label>{ct("finance.institutional.new_order.student_names_label")}</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRows((prev) => [...prev, emptyRow(prev[prev.length - 1]?.analystId ?? "")])}
                disabled={isPending}
              >
                {ct("finance.institutional.new_order.add_student_button")}
              </Button>
            </div>
            <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-dashed p-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{ct("finance.institutional.new_order.bulk_quantity_label")}</Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  className="w-24"
                  value={bulkQuantity}
                  onChange={(e) => setBulkQuantity(e.target.value)}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{ct("finance.institutional.new_order.bulk_analyst_label")}</Label>
                <Select
                  items={agents.map((a) => ({ value: a.id, label: a.name }))}
                  value={bulkAnalystId || undefined}
                  onValueChange={(v) => setBulkAnalystId((v as string) ?? "")}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder={ct("finance.institutional.new_order.student_analyst_placeholder")} />
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
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={isPending || !bulkQuantity || Number(bulkQuantity) < 1}
                onClick={() => setRows(Array.from({ length: Math.floor(Number(bulkQuantity)) }, () => emptyRow(bulkAnalystId)))}
              >
                {ct("finance.institutional.new_order.bulk_fill_button")}
              </Button>
            </div>
            <div className="space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    name="student_name"
                    value={row.name}
                    onChange={(e) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, name: e.target.value } : r)))}
                    placeholder={ct("finance.institutional.new_order.student_name_placeholder")}
                  />
                  <Select
                    items={agents.map((a) => ({ value: a.id, label: a.name }))}
                    value={row.analystId || undefined}
                    onValueChange={(v) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, analystId: (v as string) ?? "" } : r)))}
                  >
                    <SelectTrigger className="w-56 shrink-0">
                      <SelectValue placeholder={ct("finance.institutional.new_order.student_analyst_placeholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Controlled Select above has no `name` — same convention as the
                      institution/package pickers in this file — its value is mirrored
                      into this hidden input, which is what actually submits with the form. */}
                  <input type="hidden" name="student_analyst_id" value={row.analystId} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                    disabled={isPending || rows.length <= 1}
                  >
                    {ct("finance.institutional.new_order.remove_student_button")}
                  </Button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {ct("finance.institutional.new_order.total_prefix")}
              {rows.length}
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
                  variant={billingPartyType === "institution" ? "default" : "outline"}
                  onClick={() => setBillingPartyType("institution")}
                  disabled={isPending}
                >
                  {ct("finance.institutional.new_order.billing_party_institution")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={billingPartyType === "customer" ? "default" : "outline"}
                  onClick={() => setBillingPartyType("customer")}
                  disabled={isPending}
                >
                  {ct("finance.institutional.new_order.billing_party_customer")}
                </Button>
              </div>
            </div>

            {billingPartyType === "customer" ? (
              <div className="space-y-2">
                <Label htmlFor="customer_select">{ct("finance.institutional.new_order.customer_select_label")}</Label>
                {customers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{ct("finance.institutional.new_order.no_customers")}</p>
                ) : (
                  <Combobox
                    items={customerOptions}
                    value={customerOptions.find((o) => o.value === customerId) ?? null}
                    onValueChange={(o) => selectCustomer(o?.value ?? null)}
                    isItemEqualToValue={isCustomerOptionEqual}
                  >
                    <ComboboxInputGroup>
                      <ComboboxInput id="customer_select" placeholder={ct("finance.institutional.new_order.select_customer_placeholder")} />
                      <ComboboxButtonGroup>
                        <ComboboxClear aria-label={ct("finance.institutional.new_order.clear_selection")} />
                        <ComboboxTrigger aria-label={ct("finance.institutional.new_order.open_customer_list")} />
                      </ComboboxButtonGroup>
                    </ComboboxInputGroup>
                    <ComboboxContent emptyMessage={ct("finance.institutional.new_order.no_customer_match")}>
                      {(item: { value: string; label: string }) => (
                        <ComboboxItem key={item.value} value={item}>
                          {item.label}
                        </ComboboxItem>
                      )}
                    </ComboboxContent>
                  </Combobox>
                )}
                <input type="hidden" name="customer_id" value={customerId ?? ""} />
              </div>
            ) : (
              <>
              <div className="mb-3 flex justify-end gap-2">
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
              </>
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
            disabled={
              isPending ||
              (packageId === NO_PACKAGE &&
                (billingPartyType === "customer" ? !customerId : mode === "existing" && !institutionPartyId))
            }
          >
            {ct("finance.institutional.new_order.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
