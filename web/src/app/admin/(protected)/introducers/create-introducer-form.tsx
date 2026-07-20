"use client";

import { useActionState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminCreateIntroducer, type CreateIntroducerState } from "./actions";
import { ct } from "@/lib/i18n-client";

const initialState: CreateIntroducerState = { status: "idle" };

export function CreateIntroducerForm({
  sponsors,
  analysts,
}: {
  sponsors: { id: string; name: string }[];
  analysts: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(adminCreateIntroducer, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <Card>
      <CardContent className="pt-6">
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="full_name">{ct("introducers.form.name_label")}</Label>
              <Input id="full_name" name="full_name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">{ct("introducers.form.phone_label")}</Label>
              <Input id="phone" name="phone" required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{ct("introducers.form.email_label")}</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          {sponsors.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="sponsor_id">{ct("introducers.form.sponsor_label")}</Label>
              {/* Base UI's Select.Value shows the raw value unless Root gets an
                  `items` map — see the same note in register-form.tsx. */}
              <Select name="sponsor_id" items={sponsors.map((s) => ({ value: s.id, label: s.name }))}>
                <SelectTrigger id="sponsor_id" className="w-full">
                  <SelectValue placeholder={ct("introducers.form.sponsor_placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  {sponsors.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ct("introducers.form.sponsor_hint")}</p>
            </div>
          )}
          {analysts.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="assigned_analyst_id">{ct("introducers.form.assigned_analyst_label")}</Label>
              <Select name="assigned_analyst_id" items={analysts.map((a) => ({ value: a.id, label: a.name }))}>
                <SelectTrigger id="assigned_analyst_id" className="w-full">
                  <SelectValue placeholder={ct("introducers.form.assigned_analyst_placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  {analysts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ct("introducers.form.assigned_analyst_hint")}</p>
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bank_name">{ct("introducers.form.bank_name_label")}</Label>
              <Input id="bank_name" name="bank_name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bank_account_name">{ct("introducers.form.bank_account_name_label")}</Label>
              <Input id="bank_account_name" name="bank_account_name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bank_account_no">{ct("introducers.form.bank_account_no_label")}</Label>
              <Input id="bank_account_no" name="bank_account_no" />
            </div>
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "success" && <p className="text-sm">{ct("introducers.form.success")}</p>}

          <Button type="submit" disabled={isPending}>
            {isPending ? ct("introducers.form.creating") : ct("introducers.form.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
