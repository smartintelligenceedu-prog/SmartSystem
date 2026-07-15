"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const applicationSchema = z.object({
  full_name: z.string().trim().min(2, "请输入姓名"),
  email: z.string().trim().email("请输入有效的电邮地址"),
  phone: z.string().trim().min(8, "请输入有效的电话号码"),
  bank_name: z.string().trim().optional(),
  bank_account_name: z.string().trim().optional(),
  bank_account_no: z.string().trim().optional(),
  sponsor_referral_code: z.string().trim().optional(),
});

export type IntroducerApplicationState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

export async function submitIntroducerApplication(
  _prev: IntroducerApplicationState,
  formData: FormData
): Promise<IntroducerApplicationState> {
  const parsed = applicationSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    bank_name: formData.get("bank_name") || undefined,
    bank_account_name: formData.get("bank_account_name") || undefined,
    bank_account_no: formData.get("bank_account_no") || undefined,
    sponsor_referral_code: formData.get("sponsor_referral_code") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "表单资料有误" };
  }
  const input = parsed.data;

  const admin = createAdminClient();

  // Same hard-error-on-unknown-code posture as register/actions.ts — an
  // introducer's 2-level commission chain depends on this link being real.
  let sponsorId: string | null = null;
  if (input.sponsor_referral_code) {
    const { data: sponsor, error: sponsorError } = await admin
      .from("introducers")
      .select("id")
      .eq("referral_code", input.sponsor_referral_code)
      .eq("status", "active")
      .maybeSingle();
    if (sponsorError) {
      return { status: "error", message: `查询推荐码时发生错误：${sponsorError.message}` };
    }
    if (!sponsor) {
      return { status: "error", message: "找不到这个推荐码，请跟推荐人确认后再试一次" };
    }
    sponsorId = sponsor.id;
  }

  const { error } = await admin.from("introducer_applications").insert({
    full_name: input.full_name,
    email: input.email,
    phone: input.phone,
    bank_name: input.bank_name ?? null,
    bank_account_name: input.bank_account_name ?? null,
    bank_account_no: input.bank_account_no ?? null,
    sponsor_referral_code: input.sponsor_referral_code ?? null,
    sponsor_id: sponsorId,
    status: "pending",
  });
  if (error) {
    return { status: "error", message: `提交申请时发生错误：${error.message}` };
  }

  return { status: "success" };
}
