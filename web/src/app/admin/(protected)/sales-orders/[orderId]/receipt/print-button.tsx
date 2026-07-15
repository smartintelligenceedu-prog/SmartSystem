"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export function ReceiptPrintButton({ backHref }: { backHref: string }) {
  const router = useRouter();
  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="ghost" onClick={() => router.push(backHref)}>
        {t("finance.institutional.print.back_button")}
      </Button>
      <Button size="sm" onClick={() => window.print()}>
        {t("finance.institutional.print.print_button")}
      </Button>
    </div>
  );
}
