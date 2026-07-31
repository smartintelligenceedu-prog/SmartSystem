"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitWithoutReset } from "@/lib/submit-without-reset";
import { ct } from "@/lib/i18n-client";
import { updateMarketingVoucher, deleteMarketingVoucher, setMarketingVoucherActive, type VoucherFormState } from "./actions";
import { VoucherImageDropzone } from "./voucher-image-dropzone";
import type { MarketingVoucherRow } from "./data";

const initialState: VoucherFormState = { status: "idle" };

export function VoucherCard({ voucher, canManage }: { voucher: MarketingVoucherRow; canManage: boolean }) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [state, formAction] = useActionState(updateMarketingVoucher, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      setIsEditing(false);
      router.refresh();
    }
  }, [state, router]);

  function doDelete() {
    if (!window.confirm(ct("voucher_portal.action.confirm_delete"))) return;
    startTransition(async () => {
      const result = await deleteMarketingVoucher(voucher.id);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  function doToggleActive() {
    startTransition(async () => {
      const result = await setMarketingVoucherActive(voucher.id, !voucher.is_active);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  if (isEditing) {
    return (
      <form
        ref={formRef}
        onSubmit={submitWithoutReset(formAction)}
        className="flex flex-col gap-3 rounded-lg border bg-card p-4"
      >
        <input type="hidden" name="id" value={voucher.id} />
        <div className="space-y-1">
          <Label htmlFor={`voucher-title-${voucher.id}`}>{ct("voucher_portal.form.title_label")}</Label>
          <Input id={`voucher-title-${voucher.id}`} name="title" defaultValue={voucher.title} required />
        </div>
        <div className="space-y-1">
          <Label>{ct("voucher_portal.form.image_label")}</Label>
          <VoucherImageDropzone name="image" initialPreviewUrl={voucher.image_url} />
        </div>
        {state.status === "error" && <p className="text-sm text-destructive">{state.message}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            {ct("voucher_portal.form.save_button")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
            {ct("voucher_portal.form.cancel_button")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border bg-card">
      <div className="aspect-video max-h-56 w-full overflow-hidden bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={voucher.image_url} alt={voucher.title} className="h-full w-full object-cover" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium">{voucher.title}</p>
          {canManage && (
            <Badge variant={voucher.is_active ? "secondary" : "outline"}>
              {voucher.is_active ? ct("voucher_portal.status.active") : ct("voucher_portal.status.inactive")}
            </Badge>
          )}
        </div>
        {canManage && (
          <div className="mt-auto flex flex-wrap gap-2">
            <Button size="xs" variant="outline" onClick={() => setIsEditing(true)}>
              {ct("voucher_portal.action.edit")}
            </Button>
            <Button size="xs" variant="outline" onClick={doToggleActive} disabled={isPending}>
              {voucher.is_active ? ct("voucher_portal.action.deactivate") : ct("voucher_portal.action.activate")}
            </Button>
            <Button size="xs" variant="destructive" onClick={doDelete} disabled={isPending}>
              {ct("voucher_portal.action.delete")}
            </Button>
          </div>
        )}
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
      </div>
    </div>
  );
}
