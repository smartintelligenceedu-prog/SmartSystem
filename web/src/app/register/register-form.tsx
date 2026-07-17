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
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">个人资料</p>

            <div className="space-y-2">
              <Label htmlFor="full_name">姓名（与身份证件一致）</Label>
              <Input id="full_name" name="full_name" required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="nickname">昵称</Label>
              <Input id="nickname" name="nickname" required placeholder="系统内显示用的称呼" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ic_or_passport_no">身份证 / 护照号码</Label>
              <Input id="ic_or_passport_no" name="ic_or_passport_no" required />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">电话</Label>
                <Input id="phone" name="phone" type="tel" required placeholder="01x-xxxxxxx" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">电邮</Label>
                <Input id="email" name="email" type="email" required />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ic_document">上传身份证照片</Label>
              <Input id="ic_document" name="ic_document" type="file" accept="image/*,.pdf" required />
            </div>
          </section>

          <Separator />

          <section className="space-y-5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              银行资料（用于佣金发放）
            </p>

            <div className="space-y-2">
              <Label htmlFor="bank_name">银行名称</Label>
              <Input id="bank_name" name="bank_name" required placeholder="例：Maybank" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bank_account_name">户口持有人姓名</Label>
                <Input id="bank_account_name" name="bank_account_name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank_account_no">银行户口号码</Label>
                <Input id="bank_account_no" name="bank_account_no" required />
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">注册与缴费</p>

            <div className="space-y-2">
              <Label htmlFor="sponsor_referral_code">推荐人推荐码（选填）</Label>
              <Input
                id="sponsor_referral_code"
                name="sponsor_referral_code"
                placeholder="没有推荐人可留空"
                defaultValue={sponsorReferralCode ?? ""}
              />
              {sponsorReferralCode && (
                <p className="text-xs text-muted-foreground">已透过推荐连结自动带入，如有需要仍可自行修改。</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="kit_id">选择注册套装</Label>
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
                  <SelectValue placeholder="请选择套装" />
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
                套装内含 {kits[0]?.voucher_self_use_count ?? 1} 张自用检测券、
                {kits[0]?.voucher_resale_count ?? 1} 张认证后可转售检测券
                {kits[0]?.includes_business_card ? "、名片" : ""}与培训课程。
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="payment_screenshot">上传缴费截图</Label>
              <Input
                id="payment_screenshot"
                name="payment_screenshot"
                type="file"
                accept="image/*,.pdf"
                required
              />
              <p className="text-xs text-muted-foreground">
                请先依后台提供的银行户口完成转账，再上传缴费截图；后台核实后会开通你的帐号。
              </p>
            </div>
          </section>

          {agreementUrl && (
            <>
              <Separator />
              <input type="hidden" name="agreement_link_opened" value={linkOpened ? "true" : "false"} />
              <div className="space-y-2 text-sm">
                <p>
                  请先阅读{" "}
                  <a
                    href={agreementUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setLinkOpened(true)}
                    className="font-medium underline"
                  >
                    Agent Agreement / Terms and Conditions
                  </a>
                  ，才可以勾选同意并完成注册。
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
                    我已阅读并同意 Agent Agreement / Terms and Conditions
                    {!linkOpened && "（请先点击上方链接）"}
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
            {isPending ? "处理中…" : "提交注册"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
