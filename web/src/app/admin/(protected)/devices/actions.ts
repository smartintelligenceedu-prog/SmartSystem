"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

async function requireBackOfficeUserId(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: await t("devices.error.not_logged_in") };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  if (!isBackOffice) return { error: await t("devices.error.no_permission") };

  const { data: userRow } = await supabase.from("users").select("id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: await t("devices.error.no_user_row") };

  return { userId: userRow.id };
}

const createDeviceSchema = z.object({
  serial_no: z.string().trim().min(1, await t("devices.error.serial_required")),
  model: z.string().trim().optional(),
});

export type CreateDeviceState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

export async function createDevice(_prev: CreateDeviceState, formData: FormData): Promise<CreateDeviceState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const parsed = createDeviceSchema.safeParse({
    serial_no: formData.get("serial_no"),
    model: formData.get("model") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? await t("devices.error.invalid_form") };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("devices").insert({ serial_no: parsed.data.serial_no, model: parsed.data.model || null });
  if (error) return { status: "error", message: `${await t("devices.error.create_failed")}${error.message}` };

  revalidatePath("/admin/devices");
  return { status: "success" };
}
