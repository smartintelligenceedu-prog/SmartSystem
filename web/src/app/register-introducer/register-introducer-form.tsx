"use client";

import { useActionState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { submitIntroducerApplication, type IntroducerApplicationState } from "./actions";

const initialState: IntroducerApplicationState = { status: "idle" };

export function RegisterIntroducerForm() {
  const [state, formAction, isPending] = useActionState(submitIntroducerApplication, initialState);

  if (state.status === "success") {
    return (
      <div className="rounded-md border p-6 text-sm">
        <p className="font-medium">申请已提交</p>
        <p className="mt-1 text-muted-foreground">请等待后台审核，审核通过后我们会与您联系。</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
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
      <div className="space-y-2">
        <Label htmlFor="sponsor_referral_code">推荐人推荐码（选填）</Label>
        <Input id="sponsor_referral_code" name="sponsor_referral_code" placeholder="如果是被别的引荐人邀请，请填写对方的推荐码" />
      </div>
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

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "提交中…" : "提交申请"}
      </Button>
    </form>
  );
}
