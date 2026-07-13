"use client";

import { useActionState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminCreateIntroducer, type CreateIntroducerState } from "./actions";

const initialState: CreateIntroducerState = { status: "idle" };

export function CreateIntroducerForm({ sponsors }: { sponsors: { id: string; name: string }[] }) {
  const [state, formAction, isPending] = useActionState(adminCreateIntroducer, initialState);
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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="full_name">姓名</Label>
              <Input id="full_name" name="full_name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">电话</Label>
              <Input id="phone" name="phone" required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">电邮</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          {sponsors.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="sponsor_id">上线引荐人（选填）</Label>
              {/* Base UI's Select.Value shows the raw value unless Root gets an
                  `items` map — see the same note in register-form.tsx. */}
              <Select name="sponsor_id" items={sponsors.map((s) => ({ value: s.id, label: s.name }))}>
                <SelectTrigger id="sponsor_id" className="w-full">
                  <SelectValue placeholder="没有上线引荐人可留空" />
                </SelectTrigger>
                <SelectContent>
                  {sponsors.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">如果这位引荐人是被别的引荐人介绍进来的，选择上线可以让上线也拿到 Level 2 佣金。</p>
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bank_name">银行名称（选填）</Label>
              <Input id="bank_name" name="bank_name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bank_account_name">户口持有人（选填）</Label>
              <Input id="bank_account_name" name="bank_account_name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bank_account_no">户口号码（选填）</Label>
              <Input id="bank_account_no" name="bank_account_no" />
            </div>
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "success" && <p className="text-sm">已建立引荐人</p>}

          <Button type="submit" disabled={isPending}>
            {isPending ? "建立中…" : "建立引荐人"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
