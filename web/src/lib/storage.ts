import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export type UploadBucket = "ic-documents" | "payment-screenshots";

// `label` is a caller-supplied, already-translated noun (e.g. "payment
// screenshot") — this function only owns the surrounding sentence.
export async function validateUploadFile(file: File | null, label: string, required: boolean): Promise<string | null> {
  if (!file || file.size === 0) {
    return required ? `${await t("upload.error.required_prefix")}${label}` : null;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${label}${await t("upload.error.too_large_suffix")}`;
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
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
