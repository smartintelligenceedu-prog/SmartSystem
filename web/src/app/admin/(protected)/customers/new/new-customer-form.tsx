"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createCustomer, type CreateCustomerState } from "../actions";

const initialState: CreateCustomerState = { status: "idle" };

export function NewCustomerForm({ introducers }: { introducers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(createCustomer, initialState);

  useEffect(() => {
    if (state.status === "success") {
      router.push("/admin/customers");
    }
  }, [state, router]);

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="full_name">姓名</Label>
            <Input id="full_name" name="full_name" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">电话</Label>
              <Input id="phone" name="phone" type="tel" required placeholder="01x-xxxxxxx" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">电邮（选填）</Label>
              <Input id="email" name="email" type="email" />
            </div>
          </div>

          {introducers.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="acquired_via_introducer_id">来源引荐人（选填）</Label>
              {/* Base UI's Select.Value shows the raw value unless Root gets an
                  `items` map — see the same note in register-form.tsx. */}
              <Select
                name="acquired_via_introducer_id"
                items={introducers.map((i) => ({ value: i.id, label: i.name }))}
              >
                <SelectTrigger id="acquired_via_introducer_id" className="w-full">
                  <SelectValue placeholder="没有引荐人可留空" />
                </SelectTrigger>
                <SelectContent>
                  {introducers.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? "建立中…" : "登记顾客"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
