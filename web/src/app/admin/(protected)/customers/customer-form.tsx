"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createCustomer, updateCustomer, type CustomerFormState } from "./actions";
import { ct } from "@/lib/i18n-client";

const initialState: CustomerFormState = { status: "idle" };

interface ChildInput {
  full_name: string;
  gender: string;
  date_of_birth: string;
  school: string;
  remark: string;
}

const GENDER_OPTIONS = [
  { value: "male", label: ct("customer.field.gender.male") },
  { value: "female", label: ct("customer.field.gender.female") },
  { value: "other", label: ct("customer.field.gender.other") },
  { value: "undisclosed", label: ct("customer.field.gender.undisclosed") },
];

const MARITAL_OPTIONS = [
  { value: "single", label: ct("customer.field.marital_status.single") },
  { value: "married", label: ct("customer.field.marital_status.married") },
  { value: "divorced", label: ct("customer.field.marital_status.divorced") },
  { value: "widowed", label: ct("customer.field.marital_status.widowed") },
  { value: "other", label: ct("customer.field.marital_status.other") },
];

export interface CustomerFormInitialValues {
  full_name?: string;
  phone?: string;
  email?: string;
  gender?: string;
  date_of_birth?: string;
  occupation?: string;
  marital_status?: string;
  acquired_via_introducer_id?: string;
  children?: ChildInput[];
}

export function CustomerForm({
  mode,
  customerId,
  introducers,
  initialValues,
  leadId,
}: {
  mode: "create" | "edit";
  customerId?: string;
  introducers: { id: string; name: string }[];
  initialValues?: CustomerFormInitialValues;
  leadId?: string;
}) {
  const router = useRouter();
  const action = mode === "edit" && customerId ? updateCustomer.bind(null, customerId) : createCustomer;
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [children, setChildren] = useState<ChildInput[]>(initialValues?.children ?? []);

  useEffect(() => {
    if (state.status === "success") {
      router.push(`/admin/customers/${state.customerId}`);
    }
  }, [state, router]);

  function addChild() {
    setChildren((prev) => [...prev, { full_name: "", gender: "", date_of_birth: "", school: "", remark: "" }]);
  }
  function removeChild(index: number) {
    setChildren((prev) => prev.filter((_, i) => i !== index));
  }
  function updateChild(index: number, field: keyof ChildInput, value: string) {
    setChildren((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-6">
          <input type="hidden" name="children_json" value={JSON.stringify(children)} />
          {leadId && <input type="hidden" name="lead_id" value={leadId} />}

          <section className="space-y-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("customer.form.section.basic")}</p>
            <div className="space-y-2">
              <Label htmlFor="full_name">{ct("customer.field.full_name")}</Label>
              <Input id="full_name" name="full_name" defaultValue={initialValues?.full_name} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">{ct("customer.field.phone")}</Label>
                <Input id="phone" name="phone" type="tel" defaultValue={initialValues?.phone} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{ct("customer.field.email")}</Label>
                <Input id="email" name="email" type="email" defaultValue={initialValues?.email} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="date_of_birth">{ct("customer.field.date_of_birth")}</Label>
              <Input id="date_of_birth" name="date_of_birth" type="date" defaultValue={initialValues?.date_of_birth} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="gender">{ct("customer.field.gender")}</Label>
                <Select name="gender" items={GENDER_OPTIONS} defaultValue={initialValues?.gender}>
                  <SelectTrigger id="gender" className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDER_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="marital_status">{ct("customer.field.marital_status")}</Label>
                <Select name="marital_status" items={MARITAL_OPTIONS} defaultValue={initialValues?.marital_status}>
                  <SelectTrigger id="marital_status" className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {MARITAL_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="occupation">{ct("customer.field.occupation")}</Label>
              <Input id="occupation" name="occupation" defaultValue={initialValues?.occupation} />
            </div>
            {introducers.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="acquired_via_introducer_id">{ct("customer.field.introducer")}</Label>
                <Select
                  name="acquired_via_introducer_id"
                  items={introducers.map((i) => ({ value: i.id, label: i.name }))}
                  defaultValue={initialValues?.acquired_via_introducer_id}
                >
                  <SelectTrigger id="acquired_via_introducer_id" className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {introducers.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </section>

          <Separator />

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("customer.child.section_title")}</p>
              <Button type="button" size="sm" variant="outline" onClick={addChild}>
                {ct("customer.child.add_button")}
              </Button>
            </div>
            {children.length === 0 && <p className="text-sm text-muted-foreground">{ct("customer.child.none")}</p>}
            {children.map((child, index) => (
              <div key={index} className="space-y-3 rounded-md border p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{ct("customer.child.full_name")}</Label>
                    <Input value={child.full_name} onChange={(e) => updateChild(index, "full_name", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{ct("customer.child.date_of_birth")}</Label>
                    <Input type="date" value={child.date_of_birth} onChange={(e) => updateChild(index, "date_of_birth", e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{ct("customer.child.gender")}</Label>
                    <Select
                      items={GENDER_OPTIONS}
                      value={child.gender}
                      onValueChange={(v) => updateChild(index, "gender", v ?? "")}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {GENDER_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{ct("customer.child.school")}</Label>
                    <Input value={child.school} onChange={(e) => updateChild(index, "school", e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{ct("customer.child.remark")}</Label>
                  <Textarea value={child.remark} onChange={(e) => updateChild(index, "remark", e.target.value)} />
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => removeChild(index)}>
                  {ct("customer.child.remove_button")}
                </Button>
              </div>
            ))}
          </section>

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? ct("customer.form.saving") : mode === "create" ? ct("customer.form.submit_create") : ct("customer.form.submit_edit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
