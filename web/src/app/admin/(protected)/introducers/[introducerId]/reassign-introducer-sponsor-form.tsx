"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminReassignIntroducerSponsor } from "../actions";
import type { IntroducerDetail } from "../data";
import { ct } from "@/lib/i18n-client";

// Same reassign-after-the-fact pattern as an analyst's sponsor card in
// registrations/[analystId]/review-panel.tsx — an introducer applied before
// their own referrer's link was known, or was attributed to the wrong
// person, and back office needs a way to fix it later. The RPC itself
// (admin_reassign_introducer_sponsor) rejects self-reference and cycles;
// this form just surfaces whatever error message that produces.
export function ReassignIntroducerSponsorForm({
  detail,
  introducers,
}: {
  detail: IntroducerDetail;
  introducers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [sponsorId, setSponsorId] = useState(detail.sponsor_id ?? "");
  const sponsorOptions = introducers.filter((i) => i.id !== detail.introducer_id);

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("introducers.detail.sponsor_heading")}</p>
        <p className="text-sm text-muted-foreground">
          {ct("introducers.detail.field.sponsor")}
          {detail.sponsor_name ?? ct("introducers.detail.none")}
        </p>
        <div className="flex gap-2">
          <Select
            items={sponsorOptions.map((s) => ({ value: s.id, label: s.name }))}
            value={sponsorId}
            onValueChange={(value) => setSponsorId(value ?? "")}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={ct("introducers.detail.sponsor_placeholder")} />
            </SelectTrigger>
            <SelectContent>
              {sponsorOptions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="secondary"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await adminReassignIntroducerSponsor(detail.introducer_id, sponsorId || null);
                setMessage(result.message);
                if (result.ok) router.refresh();
              })
            }
          >
            {ct("introducers.detail.save")}
          </Button>
        </div>
        {message && <p className="text-sm">{message}</p>}
      </CardContent>
    </Card>
  );
}
