"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { submitRegistration, type RegistrationState } from "./actions";
import type { RegistrationKit } from "@/lib/types/registration";
import { ct } from "@/lib/i18n-client";

const initialState: RegistrationState = { status: "idle" };

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

export function RegisterForm({
  kits,
  agreementUrl,
  sponsorReferralCode,
}: {
  kits: RegistrationKit[];
  agreementUrl: string;
  sponsorReferralCode?: string;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(submitRegistration, initialState);
  // The checkbox stays disabled until the agreement link has actually been
  // opened — ticking "I've read it" without ever opening the document isn't
  // meaningful consent. agreement_link_opened travels to the server as a
  // hidden field so submitRegistration() can re-check it rather than trust
  // client state alone.
  const [linkOpened, setLinkOpened] = useState(false);

  useEffect(() => {
    if (state.status === "success") {
      router.push(`/register/pending/${state.result.order_id}`);
    }
  }, [state, router]);

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-6">
          <section className="space-y-5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("register.form.personal_info_heading")}</p>

            <div className="space-y-2">
              <Label htmlFor="full_name">{ct("register.form.full_name_label")}</Label>
              <Input id="full_name" name="full_name" required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="nickname">{ct("register.form.nickname_label")}</Label>
              <Input id="nickname" name="nickname" required placeholder={ct("register.form.nickname_placeholder")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ic_or_passport_no">{ct("register.form.ic_label")}</Label>
              <Input id="ic_or_passport_no" name="ic_or_passport_no" required />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">{ct("register.form.phone_label")}</Label>
                <Input id="phone" name="phone" type="tel" required placeholder={ct("register.form.phone_placeholder")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{ct("register.form.email_label")}</Label>
                <Input id="email" name="email" type="email" required />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ic_document">{ct("register.form.ic_document_label")}</Label>
              <Input id="ic_document" name="ic_document" type="file" accept="image/*,.pdf" required />
            </div>
          </section>

          <Separator />

          <section className="space-y-5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {ct("register.form.bank_info_heading")}
            </p>

            <div className="space-y-2">
              <Label htmlFor="bank_name">{ct("register.form.bank_name_label")}</Label>
              <Input id="bank_name" name="bank_name" required placeholder={ct("register.form.bank_name_placeholder")} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bank_account_name">{ct("register.form.bank_account_name_label")}</Label>
                <Input id="bank_account_name" name="bank_account_name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank_account_no">{ct("register.form.bank_account_no_label")}</Label>
                <Input id="bank_account_no" name="bank_account_no" required />
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("register.form.registration_payment_heading")}</p>

            <div className="space-y-2">
              <Label htmlFor="sponsor_referral_code">{ct("register.form.sponsor_code_label")}</Label>
              <Input
                id="sponsor_referral_code"
                name="sponsor_referral_code"
                placeholder={ct("register.form.sponsor_code_placeholder")}
                defaultValue={sponsorReferralCode ?? ""}
              />
              {sponsorReferralCode && (
                <p className="text-xs text-muted-foreground">{ct("register.form.sponsor_code_hint")}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="kit_id">{ct("register.form.kit_label")}</Label>
              {/* Base UI's Select.Value shows the raw value unless the Root gets an
                  `items` map — unlike Radix, it does not resolve the label from the
                  matching SelectItem's children automatically. */}
              <Select
                name="kit_id"
                items={kits.map((kit) => ({ value: kit.id, label: `${kit.name} — ${formatMYR(kit.price)}` }))}
                defaultValue={kits[0]?.id}
                required
              >
                <SelectTrigger id="kit_id" className="w-full">
                  <SelectValue placeholder={ct("register.form.kit_placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  {kits.map((kit) => (
                    <SelectItem key={kit.id} value={kit.id}>
                      {kit.name} — {formatMYR(kit.price)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {ct("register.form.kit_hint_prefix")}{kits[0]?.voucher_self_use_count ?? 1}{ct("register.form.kit_hint_self_use_suffix")}
                {kits[0]?.voucher_resale_count ?? 1}{ct("register.form.kit_hint_resale_suffix")}
                {kits[0]?.includes_business_card ? ct("register.form.kit_hint_business_card") : ""}{ct("register.form.kit_hint_suffix")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="payment_screenshot">{ct("register.form.payment_screenshot_label")}</Label>
              <Input
                id="payment_screenshot"
                name="payment_screenshot"
                type="file"
                accept="image/*,.pdf"
                required
              />
              <p className="text-xs text-muted-foreground">
                {ct("register.form.payment_screenshot_hint")}
              </p>
            </div>
          </section>

          {agreementUrl && (
            <>
              <Separator />
              <input type="hidden" name="agreement_link_opened" value={linkOpened ? "true" : "false"} />
              <div className="space-y-2 text-sm">
                <p>
                  {ct("register.form.agreement_prefix")}
                  <a
                    href={agreementUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setLinkOpened(true)}
                    className="font-medium underline"
                  >
                    Agent Agreement / Terms and Conditions
                  </a>
                  {ct("register.form.agreement_suffix")}
                </p>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    name="agree_to_terms"
                    required
                    disabled={!linkOpened}
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span className={linkOpened ? undefined : "text-muted-foreground"}>
                    {ct("register.form.agree_checkbox_prefix")}
                    {!linkOpened && ct("register.form.agree_checkbox_note")}
                  </span>
                </label>
              </div>
            </>
          )}

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? ct("register.form.submitting") : ct("register.form.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
