import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB
// iPhones shoot in HEIC/HEIF by default (Settings > Camera > Formats > High
// Efficiency) — Safari does NOT always transcode this to JPEG on upload the
// way some other browsers do, so a real iPhone user can hit "invalid file
// type" on a totally normal photo depending on their camera settings. Some
// iOS/Safari versions also report an empty file.type for these instead of
// the correct MIME type, so extension is checked as a fallback below.
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"];

export type UploadBucket = "ic-documents" | "payment-screenshots";

// Voucher card images (Voucher Portal) — a distinct, wider allowlist than
// registration documents (gif/svg make sense for promotional graphics but
// not for an IC photo or payment screenshot), a smaller size cap (5MB, per
// the feature's own spec), and a public bucket rather than private +
// signed URL (no PII, meant to be freely viewable).
const VOUCHER_MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
const VOUCHER_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "application/pdf"];
const VOUCHER_ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "svg", "pdf"];

export async function validateVoucherImageFile(file: File | null, required: boolean): Promise<string | null> {
  if (!file || file.size === 0) {
    return required ? await t("voucher_portal.error.image_required") : null;
  }
  if (file.size > VOUCHER_MAX_UPLOAD_BYTES) {
    return await t("voucher_portal.error.file_too_large");
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!VOUCHER_ALLOWED_TYPES.includes(file.type) && !VOUCHER_ALLOWED_EXTENSIONS.includes(extension)) {
    return await t("voucher_portal.error.invalid_file_type");
  }
  return null;
}

/** Uploads to the public voucher-images bucket and returns the storage path. */
export async function uploadVoucherImage(file: File): Promise<{ path: string | null; error: string | null }> {
  const admin = createAdminClient();
  const extension = file.name.split(".").pop() ?? "bin";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

  const { error } = await admin.storage.from("voucher-images").upload(path, await file.arrayBuffer(), {
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    return { path: null, error: error.message };
  }
  return { path, error: null };
}

/** Public bucket — direct URL, no signing needed. */
export function getPublicVoucherImageUrl(path: string): string {
  const admin = createAdminClient();
  return admin.storage.from("voucher-images").getPublicUrl(path).data.publicUrl;
}

export async function deleteVoucherImage(path: string): Promise<void> {
  const admin = createAdminClient();
  await admin.storage.from("voucher-images").remove([path]);
}

// `label` is a caller-supplied, already-translated noun (e.g. "payment
// screenshot") — this function only owns the surrounding sentence.
export async function validateUploadFile(file: File | null, label: string, required: boolean): Promise<string | null> {
  if (!file || file.size === 0) {
    return required ? `${await t("upload.error.required_prefix")}${label}` : null;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${label}${await t("upload.error.too_large_suffix")}`;
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_TYPES.includes(file.type) && !ALLOWED_EXTENSIONS.includes(extension)) {
    return `${label}${await t("upload.error.invalid_type_suffix")}`;
  }
  return null;
}

/** Uploads to a private bucket and returns the storage path (not a public URL — these buckets have public: false). */
export async function uploadRegistrationDocument(
  bucket: UploadBucket,
  partyId: string,
  file: File
): Promise<{ path: string | null; error: string | null }> {
  const admin = createAdminClient();
  const extension = file.name.split(".").pop() ?? "bin";
  const path = `${partyId}/${bucket}-${Date.now()}.${extension}`;

  const { error } = await admin.storage.from(bucket).upload(path, await file.arrayBuffer(), {
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    return { path: null, error: error.message };
  }
  return { path, error: null };
}

/** Signed URL for the admin review UI — documents live in private buckets, so this is the only way to view them. */
export async function getSignedDocumentUrl(bucket: UploadBucket, path: string | null): Promise<string | null> {
  if (!path) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 60 * 10); // 10 minutes
  if (error) return null;
  return data.signedUrl;
}
