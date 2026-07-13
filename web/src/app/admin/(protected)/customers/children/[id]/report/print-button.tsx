"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export function ReportPrintButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="ghost" onClick={() => router.push(`/admin/customers/${customerId}`)}>
        {t("tqc.print.back_button")}
      </Button>
      <Button size="sm" onClick={() => window.print()}>
        {t("tqc.print.print_button")}
      </Button>
    </div>
  );
}
