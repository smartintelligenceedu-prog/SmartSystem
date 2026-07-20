"use client";

import { useActionState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { submitIntroducerApplication, type IntroducerApplicationState } from "./actions";
import { ct } from "@/lib/i18n-client";

const initialState: IntroducerApplicationState = { status: "idle" };

export function RegisterIntroducerForm() {
  const [state, formAction, isPending] = useActionState(submitIntroducerApplication, initialState);

  if (state.status === "success") {
    return (
      <div className="rounded-md border p-6 text-sm">
        <p className="font-medium">{ct("register_introducer.form.success_title")}</p>
        <p className="mt-1 text-muted-foreground">{ct("register_introducer.form.success_body")}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="full_name">{ct("register_introducer.form.full_name_label")}</Label>
          <Input id="full_name" name="full_name" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">{ct("register_introducer.form.phone_label")}</Label>
          <Input id="phone" name="phone" required />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">{ct("register_introducer.form.email_label")}</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sponsor_referral_code">{ct("register_introducer.form.sponsor_code_label")}</Label>
        <Input id="sponsor_referral_code" name="sponsor_referral_code" placeholder={ct("register_introducer.form.sponsor_code_placeholder")} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="bank_name">{ct("register_introducer.form.bank_name_label")}</Label>
          <Input id="bank_name" name="bank_name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bank_account_name">{ct("register_introducer.form.bank_account_name_label")}</Label>
          <Input id="bank_account_name" name="bank_account_name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bank_account_no">{ct("register_introducer.form.bank_account_no_label")}</Label>
          <Input id="bank_account_no" name="bank_account_no" />
        </div>
      </div>

      {state.status === "error" && (
        <p className="text-sm text-destructive" role="alert">
          {state.message}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? ct("register_introducer.form.submitting") : ct("register_introducer.form.submit")}
      </Button>
    </form>
  );
}
