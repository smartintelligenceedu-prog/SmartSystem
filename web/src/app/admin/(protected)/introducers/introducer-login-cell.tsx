"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { adminCreateIntroducerLogin } from "./actions";
import { ct } from "@/lib/i18n-client";

export function IntroducerLoginCell({ introducerId, hasLogin }: { introducerId: string; hasLogin: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  if (hasLogin) {
    return <Badge variant="secondary">{ct("introducers.login_cell.active")}</Badge>;
  }

  if (!showForm) {
    return (
      <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
        {ct("introducers.login_cell.create")}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={ct("introducers.login_cell.password_placeholder")}
          className="h-8 w-32"
        />
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await adminCreateIntroducerLogin(introducerId, password);
              setMessage(result.message);
              if (result.ok) router.refresh();
            })
          }
        >
          {ct("introducers.login_cell.confirm")}
        </Button>
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
