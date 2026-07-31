"use client";

import { useRef, useState } from "react";
import { FileTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/i18n-client";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "svg", "pdf"];

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

// Drag-and-drop voucher card image picker: 16:9 preview for images, a
// document icon + filename for PDFs, and a Remove control to clear the
// selection. Renders a real (visually hidden) <input type="file"> so it
// still participates in the surrounding <form>'s normal submission via
// FormData — no separate upload step or client state to wire up.
export function VoucherImageDropzone({
  name,
  required,
  initialPreviewUrl,
}: {
  name: string;
  required?: boolean;
  initialPreviewUrl?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPreviewUrl ?? null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isPdf, setIsPdf] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyFile(file: File | null) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(ct("voucher_portal.error.file_too_large"));
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      setError(ct("voucher_portal.error.invalid_file_type"));
      return;
    }
    if (inputRef.current) {
      const dt = new DataTransfer();
      dt.items.add(file);
      inputRef.current.files = dt.files;
    }
    setFileName(file.name);
    if (isPdfFile(file)) {
      setIsPdf(true);
      setPreviewUrl(null);
    } else {
      setIsPdf(false);
      setPreviewUrl(URL.createObjectURL(file));
    }
  }

  function clear() {
    if (inputRef.current) inputRef.current.value = "";
    setPreviewUrl(null);
    setFileName(null);
    setIsPdf(false);
    setError(null);
  }

  const hasFile = !!previewUrl || !!fileName;

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          applyFile(e.dataTransfer.files?.[0] ?? null);
        }}
        onClick={() => {
          if (!hasFile) inputRef.current?.click();
        }}
        className={`relative flex aspect-video max-h-56 w-full items-center justify-center overflow-hidden rounded-lg border-2 border-dashed transition-colors ${
          isDragging ? "border-primary bg-primary/5" : "border-input"
        } ${!hasFile ? "cursor-pointer hover:border-primary/50" : ""}`}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : isPdf ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <FileTextIcon className="size-10" />
            <span className="max-w-[80%] truncate text-sm">{fileName}</span>
          </div>
        ) : (
          <div className="px-4 text-center text-sm text-muted-foreground">{ct("voucher_portal.dropzone.prompt")}</div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        name={name}
        required={required && !hasFile}
        accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,application/pdf,.jpg,.jpeg,.png,.webp,.gif,.svg,.pdf"
        className="hidden"
        onChange={(e) => applyFile(e.currentTarget.files?.[0] ?? null)}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">📸 {ct("voucher_portal.dropzone.helper_text")}</p>
        {hasFile && (
          <Button type="button" size="xs" variant="outline" onClick={clear}>
            {ct("voucher_portal.dropzone.remove_button")}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
