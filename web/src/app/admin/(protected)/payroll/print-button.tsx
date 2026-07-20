"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/i18n-client";

export function PayrollPrintButton() {
  const router = useRouter();
  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="ghost" onClick={() => router.push("/admin/payroll")}>
        {ct("payroll.print.back_button")}
      </Button>
      <Button size="sm" onClick={() => window.print()}>
        {ct("payroll.print.print_button")}
      </Button>
    </div>
  );
}
