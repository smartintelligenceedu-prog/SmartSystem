"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/i18n-client";

export function ReportPrintButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="ghost" onClick={() => router.push(`/admin/customers/${customerId}`)}>
        {ct("tqc.print.back_button")}
      </Button>
      <Button size="sm" onClick={() => window.print()}>
        {ct("tqc.print.print_button")}
      </Button>
    </div>
  );
}
