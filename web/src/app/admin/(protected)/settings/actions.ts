"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";
import { COMPANY_INFO_SETTINGS_KEY } from "./data";

async function requireBackOfficeUserId(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("settings.error.not_logged_in") };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  if (!isBackOffice) return { error: t("settings.error.no_permission") };

  const { data: userRow } = await supabase.from("users").select("id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: t("settings.error.no_user_row") };

  return { userId: userRow.id };
}

const companyInfoSchema = z.object({
  name: z.string().trim().min(1, t("settings.error.name_required")),
  ssmNumber: z.string().trim(),
  addressLine1: z.string().trim(),
  addressLine2: z.string().trim(),
  phone: z.string().trim(),
  email: z.string().trim().email(t("settings.error.invalid_email")).or(z.literal("")),
  bankName: z.string().trim(),
  bankAccountName: z.string().trim(),
  bankAccountNumber: z.string().trim(),
  invoiceTerms: z.string().trim(),
});

export type UpdateCompanyInfoState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

export async function updateCompanyInfo(_prev: UpdateCompanyInfoState, formData: FormData): Promise<UpdateCompanyInfoState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const parsed = companyInfoSchema.safeParse({
    name: formData.get("name"),
    ssmNumber: formData.get("ssmNumber"),
    addressLine1: formData.get("addressLine1"),
    addressLine2: formData.get("addressLine2"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    bankName: formData.get("bankName"),
    bankAccountName: formData.get("bankAccountName"),
    bankAccountNumber: formData.get("bankAccountNumber"),
    invoiceTerms: formData.get("invoiceTerms"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? t("settings.error.invalid_form") };

  const admin = createAdminClient();
  const { error } = await admin.from("settings").upsert({
    key: COMPANY_INFO_SETTINGS_KEY,
    value: parsed.data,
    updated_by: auth.userId,
  });
  if (error) return { status: "error", message: `${t("settings.error.save_failed")}${error.message}` };

  revalidatePath("/admin/settings");
  return { status: "success" };
}
