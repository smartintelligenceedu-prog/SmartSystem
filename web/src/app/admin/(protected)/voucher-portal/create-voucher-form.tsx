"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { submitWithoutReset } from "@/lib/submit-without-reset";
import { ct } from "@/lib/i18n-client";
import { createMarketingVoucher, type VoucherFormState } from "./actions";
import { VoucherImageDropzone } from "./voucher-image-dropzone";

const initialState: VoucherFormState = { status: "idle" };

export function CreateVoucherForm() {
  const router = useRouter();
  const [state, formAction] = useActionState(createMarketingVoucher, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  return (
    <form ref={formRef} onSubmit={submitWithoutReset(formAction)} className="space-y-3 rounded-md border bg-card p-4">
      <div className="space-y-1">
        <Label htmlFor="voucher-title">{ct("voucher_portal.form.title_label")}</Label>
        <Input id="voucher-title" name="title" placeholder={ct("voucher_portal.form.title_placeholder")} required />
      </div>
      <div className="space-y-1">
        <Label>{ct("voucher_portal.form.image_label")}</Label>
        <VoucherImageDropzone name="image" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="voucher-terms">{ct("voucher_portal.form.terms_label")}</Label>
        <Textarea id="voucher-terms" name="terms" placeholder={ct("voucher_portal.form.terms_placeholder")} rows={4} />
      </div>
      <p className="text-xs text-muted-foreground">{ct("voucher_portal.form.draft_hint")}</p>
      {state.status === "error" && <p className="text-sm text-destructive">{state.message}</p>}
      <Button type="submit">{ct("voucher_portal.page.create_button")}</Button>
    </form>
  );
}
