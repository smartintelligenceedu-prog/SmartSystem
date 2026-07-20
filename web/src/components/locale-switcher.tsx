"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setLocale } from "@/lib/locale-actions";
import { getClientLocale } from "@/lib/i18n-client";
import type { Locale } from "@/lib/i18n-shared";

// Language names are shown in their own script (中文 / EN), not translated —
// standard convention for a language switcher. Switching always does a full
// reload rather than a live re-render: several client components read the
// locale cookie at module-scope (see i18n-client.ts), so a hard reload is
// the simplest way to guarantee everything — server-rendered and
// client-rendered alike — reflects the new language consistently.
export function LocaleSwitcher({ className }: { className?: string }) {
  const [isPending, startTransition] = useTransition();
  const current = getClientLocale();

  function switchTo(locale: Locale) {
    if (locale === current || isPending) return;
    startTransition(async () => {
      await setLocale(locale);
      window.location.reload();
    });
  }

  return (
    <div className={`inline-flex items-center gap-1 ${className ?? ""}`} suppressHydrationWarning>
      <Button
        type="button"
        size="xs"
        variant={current === "zh" ? "secondary" : "ghost"}
        disabled={isPending}
        onClick={() => switchTo("zh")}
      >
        中文
      </Button>
      <Button
        type="button"
        size="xs"
        variant={current === "en" ? "secondary" : "ghost"}
        disabled={isPending}
        onClick={() => switchTo("en")}
      >
        EN
      </Button>
    </div>
  );
}
