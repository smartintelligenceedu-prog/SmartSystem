"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { compressImageFile } from "@/lib/compress-image";
import { ct } from "@/lib/i18n-client";

// Recompresses whatever photo the user picks before it ever gets attached to
// the form — see compress-image.ts for why this exists (Vercel's platform
// request-body cap, not something next.config.ts's own limit can fix).
export function CompressedFileInput({
  id,
  name,
  required,
  accept,
}: {
  id: string;
  name: string;
  required?: boolean;
  accept: string;
}) {
  const [processing, setProcessing] = useState(false);

  return (
    <div className="space-y-1">
      <Input
        id={id}
        name={name}
        type="file"
        accept={accept}
        required={required}
        disabled={processing}
        onChange={async (e) => {
          const input = e.currentTarget;
          const file = input.files?.[0];
          if (!file) return;
          setProcessing(true);
          try {
            const compressed = await compressImageFile(file);
            if (compressed !== file) {
              const dt = new DataTransfer();
              dt.items.add(compressed);
              input.files = dt.files;
            }
          } finally {
            setProcessing(false);
          }
        }}
      />
      {processing && <p className="text-xs text-muted-foreground">{ct("upload.compressing")}</p>}
    </div>
  );
}
