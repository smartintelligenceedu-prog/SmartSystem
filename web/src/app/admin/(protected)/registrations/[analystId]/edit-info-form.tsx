"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminUpdatePersonalInfo } from "../actions";
import type { RegistrationDetail } from "../data";
import { ct } from "@/lib/i18n-client";

function Field({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function EditInfoForm({ detail }: { detail: RegistrationDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: detail.full_name,
    nickname: detail.nickname ?? "",
    ic_or_passport_no: detail.ic_or_passport_no,
    phone: detail.phone,
    email: detail.email,
    bank_name: detail.bank_name ?? "",
    bank_account_name: detail.bank_account_name ?? "",
    bank_account_no: detail.bank_account_no ?? "",
  });

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {ct("registrations.detail.edit_info")}
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("registrations.detail.edit_info")}</p>
        <div className="grid grid-cols-2 gap-4">
          <Field id="edit-full-name" label={ct("registrations.detail.field.full_name")} value={form.full_name} onChange={set("full_name")} />
          <Field id="edit-nickname" label={ct("registrations.detail.field.nickname")} value={form.nickname} onChange={set("nickname")} />
          <Field id="edit-ic" label={ct("registrations.detail.field.ic")} value={form.ic_or_passport_no} onChange={set("ic_or_passport_no")} />
          <Field id="edit-phone" label={ct("registrations.detail.field.phone")} value={form.phone} onChange={set("phone")} />
          <Field id="edit-email" label={ct("registrations.detail.field.email")} value={form.email} onChange={set("email")} />
          <Field id="edit-bank-name" label={ct("registrations.detail.field.bank_name")} value={form.bank_name} onChange={set("bank_name")} />
          <Field
            id="edit-bank-account-name"
            label={ct("registrations.detail.field.bank_account_name")}
            value={form.bank_account_name}
            onChange={set("bank_account_name")}
          />
          <Field
            id="edit-bank-account-no"
            label={ct("registrations.detail.field.bank_account_no")}
            value={form.bank_account_no}
            onChange={set("bank_account_no")}
          />
        </div>
        {detail.has_login && (
          <p className="text-xs text-muted-foreground">{ct("registrations.detail.edit_email_login_note")}</p>
        )}
        {message && <p className="text-sm">{message}</p>}
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await adminUpdatePersonalInfo(detail.analyst_id, form);
                setMessage(result.message);
                if (result.ok) {
                  setOpen(false);
                  router.refresh();
                }
              })
            }
          >
            {ct("registrations.detail.save")}
          </Button>
          <Button type="button" variant="ghost" disabled={isPending} onClick={() => setOpen(false)}>
            {ct("registrations.detail.edit_cancel")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
