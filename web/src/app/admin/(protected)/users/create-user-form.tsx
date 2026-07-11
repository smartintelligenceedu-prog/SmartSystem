"use client";

import { useActionState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { adminCreateBackOfficeUser, type CreateUserState } from "./actions";

const initialState: CreateUserState = { status: "idle" };

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "back_office", label: "后台人员" },
  { value: "finance", label: "财务" },
  { value: "admin", label: "管理员" },
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
            <Label htmlFor="full_name">姓名</Label>
            <Input id="full_name" name="full_name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">电邮</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">初始密码</Label>
            <Input id="password" name="password" type="password" required placeholder="至少 8 个字元" />
          </div>
          <div className="space-y-2">
            <Label>角色</Label>
            <div className="flex gap-4">
              {ROLE_OPTIONS.map((role) => (
                <label key={role.value} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="roles" value={role.value} className="size-4" />
                  {role.label}
                </label>
              ))}
            </div>
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "success" && <p className="text-sm">已建立帐号</p>}

          <Button type="submit" disabled={isPending}>
            {isPending ? "建立中…" : "建立帐号"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
