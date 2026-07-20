"use client";

import { useActionState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/i18n-client";
import { submitLead, type SubmitLeadState } from "./actions";

const initialState: SubmitLeadState = { status: "idle" };

export function LeadForm({ code }: { code: string }) {
  const [state, formAction, isPending] = useActionState(submitLead, initialState);

  if (state.status === "success") {
    return (
      <Card>
        <CardContent className="pt-6 text-center">
          <p className="text-base font-medium">{ct("refer.form.success_title")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{ct("refer.form.success_detail")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="code" value={code} />
          <div className="space-y-2">
            <Label htmlFor="contact_name">{ct("refer.form.name_label")}</Label>
            <Input id="contact_name" name="contact_name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">{ct("refer.form.phone_label")}</Label>
            <Input id="phone" name="phone" type="tel" placeholder={ct("refer.form.phone_placeholder")} required />
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? ct("refer.form.submitting") : ct("refer.form.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
