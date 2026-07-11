"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Same re-verification pattern as requireBackOfficeUserId elsewhere in this
 * codebase, but for the "caller is an approved analyst" boundary instead —
 * every write below uses the admin client (order_items and detection_vouchers
 * have no self-scope RLS insert/update policy), so this check is the only
 * thing stopping an unapproved or non-analyst caller from writing here.
 */
async function requireAnalystUserId(): Promise<{ userId: string; analystId: string } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "请先登入" };

  const { data: userRow } = await supabase.from("users").select("id, party_id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: "找不到对应的使用者资料" };

  const { data: analyst } = await supabase
    .from("analysts")
    .select("id, status")
    .eq("party_id", userRow.party_id)
    .maybeSingle();
  if (!analyst) return { error: "此帐号没有分析师身份" };
  if (analyst.status !== "approved") return { error: "此分析师帐号尚未核准，无法执行此操作" };

  return { userId: userRow.id, analystId: analyst.id };
}

const createCustomerSchema = z.object({
  full_name: z.string().trim().min(2, "请输入姓名"),
  phone: z.string().trim().min(8, "请输入有效的电话号码"),
  email: z.string().trim().email("请输入有效的电邮地址").optional().or(z.literal("")),
  acquired_via_introducer_id: z.string().uuid().optional().or(z.literal("")),
});

export type CreateCustomerState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; customerId: string };

export async function createCustomer(_prev: CreateCustomerState, formData: FormData): Promise<CreateCustomerState> {
  const auth = await requireAnalystUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const parsed = createCustomerSchema.safeParse({
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    email: formData.get("email") || undefined,
    acquired_via_introducer_id: formData.get("acquired_via_introducer_id") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "表单资料有误" };
  }
  const input = parsed.data;

  const admin = createAdminClient();

  const { data: party, error: partyError } = await admin.from("parties").insert({ party_type: "individual" }).select("id").single();
  if (partyError) return { status: "error", message: `建立资料失败：${partyError.message}` };

  const { error: individualError } = await admin.from("individuals").insert({
    party_id: party.id,
    full_name: input.full_name,
    phone: input.phone,
    email: input.email || null,
  });
  if (individualError) return { status: "error", message: `建立个人资料失败：${individualError.message}` };

  const { data: customer, error: customerError } = await admin
    .from("customers")
    .insert({
      party_id: party.id,
      owner_analyst_id: auth.analystId,
      acquired_via_introducer_id: input.acquired_via_introducer_id || null,
      status: "active",
    })
    .select("id")
    .single();
  if (customerError) return { status: "error", message: `建立顾客失败：${customerError.message}` };

  revalidatePath("/admin/customers");
  return { status: "success", customerId: customer.id };
}
