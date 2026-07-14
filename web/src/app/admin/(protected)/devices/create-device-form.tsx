"use client";

import { useActionState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { createDevice, type CreateDeviceState } from "./actions";

const initialState: CreateDeviceState = { status: "idle" };

export function CreateDeviceForm() {
  const [state, formAction, isPending] = useActionState(createDevice, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <Card>
      <CardContent className="pt-6">
        <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="serial_no">{t("devices.form.serial_no_label")}</Label>
            <Input id="serial_no" name="serial_no" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="model">{t("devices.form.model_label")}</Label>
            <Input id="model" name="model" />
          </div>
          <Button type="submit" disabled={isPending}>
            {t("devices.form.submit")}
          </Button>
        </form>
        {state.status === "error" && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {state.message}
          </p>
        )}
        {state.status === "success" && <p className="mt-2 text-sm">{t("devices.form.success")}</p>}
      </CardContent>
    </Card>
  );
}
