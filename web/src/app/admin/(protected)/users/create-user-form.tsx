"use client";

import { useActionState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { adminCreateBackOfficeUser, type CreateUserState } from "./actions";
import { ct } from "@/lib/i18n-client";

const initialState: CreateUserState = { status: "idle" };

const ROLE_OPTIONS: { value: string; labelKey: "users.role.back_office" | "users.role.finance" | "users.role.admin" }[] = [
  { value: "back_office", labelKey: "users.role.back_office" },
  { value: "finance", labelKey: "users.role.finance" },
  { value: "admin", labelKey: "users.role.admin" },
];

export function CreateUserForm() {
  const [state, formAction, isPending] = useActionState(adminCreateBackOfficeUser, initialState);
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
          <div className="space-y-2">
            <Label htmlFor="full_name">{ct("users.form.full_name")}</Label>
            <Input id="full_name" name="full_name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{ct("users.form.email")}</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{ct("users.form.password")}</Label>
            <Input id="password" name="password" type="password" required placeholder={ct("users.form.password_placeholder")} />
          </div>
          <div className="space-y-2">
            <Label>{ct("users.form.roles_label")}</Label>
            <div className="flex gap-4">
              {ROLE_OPTIONS.map((role) => (
                <label key={role.value} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="roles" value={role.value} className="size-4" />
                  {ct(role.labelKey)}
                </label>
              ))}
            </div>
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "success" && <p className="text-sm">{ct("users.form.success")}</p>}

          <Button type="submit" disabled={isPending}>
            {isPending ? ct("users.form.submitting") : ct("users.form.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
