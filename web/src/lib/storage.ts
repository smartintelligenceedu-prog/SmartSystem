import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export type UploadBucket = "ic-documents" | "payment-screenshots";

export function validateUploadFile(file: File | null, label: string, required: boolean): string | null {
  if (!file || file.size === 0) {
    return required ? `请上传${label}` : null;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${label}档案过大，请控制在 8MB 以内`;
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return `${label}只接受 JPG / PNG / WEBP / PDF 格式`;
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
