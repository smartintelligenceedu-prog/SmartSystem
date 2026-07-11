"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { adminCreateIntroducerLogin } from "./actions";

export function IntroducerLoginCell({ introducerId, hasLogin }: { introducerId: string; hasLogin: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  if (hasLogin) {
    return <Badge variant="secondary">已开通</Badge>;
  }

  if (!showForm) {
    return (
      <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
        建立登入
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
          placeholder="初始密码"
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
          确认
        </Button>
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
