"use client";

import { useRouter } from "next/navigation";
import { ct } from "@/lib/i18n-client";

// Uses browser history rather than a fixed href, so it returns to whatever
// list filters/search/tab the user came from instead of resetting them.
export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      ← {ct("common.back")}
    </button>
  );
}
