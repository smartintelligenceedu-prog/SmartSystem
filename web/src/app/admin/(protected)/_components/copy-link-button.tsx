"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/i18n-client";

export function CopyLinkButton({ path, label }: { path: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={async () => {
          const url = `${window.location.origin}${path}`;
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Some browsers/policies deny programmatic clipboard writes —
            // fall back to showing the raw link for manual copy instead of
            // silently doing nothing.
            setFallbackUrl(url);
          }
        }}
      >
        {copied ? ct("copy_link.copied") : label}
      </Button>
      {fallbackUrl && (
        <input
          readOnly
          value={fallbackUrl}
          onFocus={(e) => e.currentTarget.select()}
          className="w-64 rounded border bg-muted px-2 py-1 text-xs"
        />
      )}
    </div>
  );
}
