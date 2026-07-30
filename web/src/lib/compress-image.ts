"use client";

// Real ID/payment photos from a phone camera can be several MB each.
// Combined, two of them routinely exceed Vercel's platform-level ~4.5MB
// request body cap for serverless functions — a hard infra limit that is
// NOT the same as, and is NOT raised by, next.config.ts's
// serverActions.bodySizeLimit. Raising that setting alone was confirmed
// insufficient: a real registration still failed with a raw
// connection-level "This page couldn't load" browser error afterward.
// Compressing client-side before the file is ever added to the form is the
// actual fix — it also sidesteps HEIC entirely, since the recompressed
// output is always a normal JPEG.
export async function compressImageFile(file: File, maxDimension = 1600, quality = 0.82): Promise<File> {
  // PDFs (and anything else the browser can't decode as an image) pass
  // through untouched — server-side validation is the backstop for those.
  if (file.type === "application/pdf") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file; // never make it bigger than the original

    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch {
    // Any decode failure (an obscure format, a corrupt file, an older
    // browser without createImageBitmap support) — fall back to the
    // original file untouched rather than blocking the submission here.
    return file;
  }
}
