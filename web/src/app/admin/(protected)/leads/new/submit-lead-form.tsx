"use client";

import { useActionState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/i18n-client";
import { submitLeadFromPortal, type SubmitLeadState } from "./actions";
import { submitWithoutReset } from "@/lib/submit-without-reset";

const initialState: SubmitLeadState = { status: "idle" };

export function SubmitLeadForm() {
  const [state, formAction, isPending] = useActionState(submitLeadFromPortal, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <Card>
      <CardContent className="pt-6">
        <form ref={formRef} onSubmit={submitWithoutReset(formAction)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="contact_name">{ct("leads.submit.form.name_label")}</Label>
            <Input id="contact_name" name="contact_name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">{ct("leads.submit.form.phone_label")}</Label>
            <Input id="phone" name="phone" type="tel" placeholder={ct("leads.submit.form.phone_placeholder")} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{ct("leads.submit.form.email_label")}</Label>
            <Input id="email" name="email" type="email" />
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "success" && <p className="text-sm text-emerald-600">{ct("leads.submit.form.success")}</p>}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? ct("leads.submit.form.submitting") : ct("leads.submit.form.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
