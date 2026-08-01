"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminResetIntroducerPassword } from "../actions";
import type { IntroducerDetail } from "../data";
import { ct } from "@/lib/i18n-client";

export function IntroducerLoginAccountCard({ detail }: { detail: IntroducerDetail }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [customPassword, setCustomPassword] = useState("");

  if (!detail.has_login) {
    return (
      <Card>
        <CardContent className="space-y-2 pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("introducers.detail.login_heading")}</p>
          <p className="text-sm text-muted-foreground">{ct("introducers.detail.no_login_note")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("introducers.detail.login_heading")}</p>
        <Badge variant="secondary">{ct("role.introducer")}</Badge>

        <div className="space-y-1">
          <Label htmlFor="custom-password">{ct("introducers.detail.custom_password_label")}</Label>
          <Input
            id="custom-password"
            type="text"
            value={customPassword}
            onChange={(e) => setCustomPassword(e.target.value)}
            placeholder={ct("introducers.detail.custom_password_placeholder")}
            className="max-w-xs"
          />
        </div>

        {message && <p className="text-sm">{message}</p>}

        <Button
          type="button"
          variant="outline"
          disabled={isPending || (customPassword.length > 0 && customPassword.length < 8)}
          onClick={() => {
            if (!window.confirm(ct("introducers.detail.confirm_reset_password"))) return;
            startTransition(async () => {
              const result = await adminResetIntroducerPassword(detail.introducer_id, customPassword || undefined);
              setMessage(result.message);
              if (result.ok) {
                setCustomPassword("");
                router.refresh();
              }
            });
          }}
        >
          {ct("introducers.detail.reset_password_button")}
        </Button>
      </CardContent>
    </Card>
  );
}
