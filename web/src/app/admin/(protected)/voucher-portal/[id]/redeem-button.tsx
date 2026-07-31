"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/i18n-client";
import { redeemMarketingVoucher } from "../actions";

export function RedeemButton({ voucherId }: { voucherId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function doRedeem() {
    if (!window.confirm(ct("voucher_portal.detail.confirm_redeem"))) return;
    startTransition(async () => {
      const result = await redeemMarketingVoucher(voucherId);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Button onClick={doRedeem} disabled={isPending}>
        {ct("voucher_portal.detail.redeem_button")}
      </Button>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
