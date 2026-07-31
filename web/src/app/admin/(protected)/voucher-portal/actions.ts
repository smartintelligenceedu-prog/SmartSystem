"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalUserContext } from "@/lib/auth/context";
import { validateVoucherImageFile, uploadVoucherImage, deleteVoucherImage } from "@/lib/storage";
import { t } from "@/lib/i18n";

async function requireBackOfficeUserId(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: await t("voucher_portal.error.not_signed_in") };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  if (!isBackOffice) return { error: await t("voucher_portal.error.no_permission") };

  const { data: userRow } = await supabase.from("users").select("id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: await t("voucher_portal.error.no_permission") };

  return { userId: userRow.id };
}

export type VoucherFormState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

export async function createMarketingVoucher(_prev: VoucherFormState, formData: FormData): Promise<VoucherFormState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { status: "error", message: await t("voucher_portal.error.title_required") };

  const file = formData.get("image") as File | null;
  const validationError = await validateVoucherImageFile(file, true);
  if (validationError) return { status: "error", message: validationError };

  const { path, error: uploadError } = await uploadVoucherImage(file as File);
  if (uploadError || !path) {
    return { status: "error", message: `${await t("voucher_portal.error.upload_failed_prefix")}${uploadError ?? ""}` };
  }

  const terms = String(formData.get("terms") ?? "").trim();

  const admin = createAdminClient();
  const { error } = await admin.from("marketing_vouchers").insert({
    title,
    image_path: path,
    terms: terms || null,
    created_by: auth.userId,
    // Stays hidden from the introducer gallery (is_active is only ever read,
    // never inserted, elsewhere) until back office explicitly clicks 上架 —
    // lets a voucher be prepared/reviewed before it goes live.
    is_active: false,
  });
  if (error) {
    await deleteVoucherImage(path);
    return { status: "error", message: `${await t("voucher_portal.error.save_failed_prefix")}${error.message}` };
  }

  revalidatePath("/admin/voucher-portal");
  return { status: "success" };
}

export async function updateMarketingVoucher(_prev: VoucherFormState, formData: FormData): Promise<VoucherFormState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { status: "error", message: await t("voucher_portal.error.title_required") };
  const terms = String(formData.get("terms") ?? "").trim();

  const admin = createAdminClient();
  const { data: existing } = await admin.from("marketing_vouchers").select("image_path").eq("id", id).maybeSingle();
  if (!existing) return { status: "error", message: await t("voucher_portal.error.not_found") };

  // Image is optional on edit — an empty file input means "keep the current image".
  const file = formData.get("image") as File | null;
  let newPath: string | null = null;
  if (file && file.size > 0) {
    const validationError = await validateVoucherImageFile(file, false);
    if (validationError) return { status: "error", message: validationError };
    const { path, error: uploadError } = await uploadVoucherImage(file);
    if (uploadError || !path) {
      return { status: "error", message: `${await t("voucher_portal.error.upload_failed_prefix")}${uploadError ?? ""}` };
    }
    newPath = path;
  }

  const { error } = await admin
    .from("marketing_vouchers")
    .update({ title, terms: terms || null, ...(newPath ? { image_path: newPath } : {}) })
    .eq("id", id);
  if (error) {
    if (newPath) await deleteVoucherImage(newPath);
    return { status: "error", message: `${await t("voucher_portal.error.save_failed_prefix")}${error.message}` };
  }

  // Old image is only removed once the new one is confirmed saved above —
  // if the update had failed, the just-uploaded replacement gets cleaned up
  // instead (see the branch above), leaving the original image intact.
  if (newPath) await deleteVoucherImage(existing.image_path);

  revalidatePath("/admin/voucher-portal");
  return { status: "success" };
}

export async function deleteMarketingVoucher(id: string): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { data: existing } = await admin.from("marketing_vouchers").select("image_path").eq("id", id).maybeSingle();
  if (!existing) return { ok: false, message: await t("voucher_portal.error.not_found") };

  const { error } = await admin.from("marketing_vouchers").delete().eq("id", id);
  if (error) return { ok: false, message: `${await t("voucher_portal.error.save_failed_prefix")}${error.message}` };

  await deleteVoucherImage(existing.image_path);

  revalidatePath("/admin/voucher-portal");
  return { ok: true, message: await t("voucher_portal.success.deleted") };
}

export async function setMarketingVoucherActive(id: string, isActive: boolean): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { error } = await admin.from("marketing_vouchers").update({ is_active: isActive }).eq("id", id);
  if (error) return { ok: false, message: `${await t("voucher_portal.error.save_failed_prefix")}${error.message}` };

  revalidatePath("/admin/voucher-portal");
  return { ok: true, message: await t("voucher_portal.success.status_updated") };
}

// Introducer-only action (not back office — there's no "back office's own
// redemption" concept). One redemption per introducer per voucher, enforced
// by the unique(voucher_id, introducer_id) constraint (migration 057) — the
// insert's unique_violation is treated as "already redeemed" rather than a
// hard error, since a double-click racing this same check is exactly the
// scenario that constraint exists for.
export async function redeemMarketingVoucher(voucherId: string): Promise<{ ok: boolean; message: string }> {
  const context = await getPortalUserContext();
  if (!context) return { ok: false, message: await t("voucher_portal.error.not_signed_in") };
  if (!context.introducerId) return { ok: false, message: await t("voucher_portal.error.no_permission") };

  const admin = createAdminClient();
  const { data: voucher } = await admin.from("marketing_vouchers").select("id, is_active").eq("id", voucherId).maybeSingle();
  if (!voucher || !voucher.is_active) return { ok: false, message: await t("voucher_portal.error.not_found") };

  const { error } = await admin
    .from("marketing_voucher_redemptions")
    .insert({ voucher_id: voucherId, introducer_id: context.introducerId });
  if (error) {
    if (error.code === "23505") return { ok: false, message: await t("voucher_portal.error.already_redeemed") };
    return { ok: false, message: `${await t("voucher_portal.error.save_failed_prefix")}${error.message}` };
  }

  revalidatePath(`/admin/voucher-portal/${voucherId}`);
  return { ok: true, message: await t("voucher_portal.success.redeemed") };
}
