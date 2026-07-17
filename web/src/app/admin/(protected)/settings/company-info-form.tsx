"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/i18n";
import { updateCompanyInfo, type UpdateCompanyInfoState } from "./actions";
import type { CompanyInfo } from "./data";

const initialState: UpdateCompanyInfoState = { status: "idle" };

export function CompanyInfoForm({ companyInfo }: { companyInfo: CompanyInfo }) {
  const [state, formAction, isPending] = useActionState(updateCompanyInfo, initialState);

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{t("settings.company.name_label")}</label>
        <Input name="name" defaultValue={companyInfo.name} required />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{t("settings.company.ssm_label")}</label>
        <Input name="ssmNumber" defaultValue={companyInfo.ssmNumber} />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{t("settings.company.address1_label")}</label>
        <Input name="addressLine1" defaultValue={companyInfo.addressLine1} />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{t("settings.company.address2_label")}</label>
        <Input name="addressLine2" defaultValue={companyInfo.addressLine2} />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{t("settings.company.phone_label")}</label>
        <Input name="phone" defaultValue={companyInfo.phone} />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{t("settings.company.email_label")}</label>
        <Input name="email" type="email" defaultValue={companyInfo.email} />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{t("settings.company.bank_name_label")}</label>
        <Input name="bankName" defaultValue={companyInfo.bankName} />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{t("settings.company.bank_account_name_label")}</label>
        <Input name="bankAccountName" defaultValue={companyInfo.bankAccountName} />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{t("settings.company.bank_account_number_label")}</label>
        <Input name="bankAccountNumber" defaultValue={companyInfo.bankAccountNumber} />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{t("settings.company.invoice_terms_label")}</label>
        <Textarea name="invoiceTerms" defaultValue={companyInfo.invoiceTerms} rows={4} placeholder={t("settings.company.invoice_terms_placeholder")} />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{t("settings.company.agreement_url_label")}</label>
        <Input name="agreementUrl" defaultValue={companyInfo.agreementUrl} placeholder="https://…" />
      </div>

      {state.status === "error" && (
        <p className="text-xs text-destructive" role="alert">
          {state.message}
        </p>
      )}
      {state.status === "success" && <p className="text-xs text-emerald-600">{t("settings.company.save_success")}</p>}

      <Button type="submit" disabled={isPending}>
        {isPending ? t("settings.company.saving") : t("settings.company.save")}
      </Button>
    </form>
  );
}
