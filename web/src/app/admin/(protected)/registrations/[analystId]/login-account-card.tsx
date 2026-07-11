"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { adminCreateAnalystLogin, adminUpdateAnalystExtraRoles } from "../actions";
import { ROLE_LABEL } from "@/lib/auth/roles";
import type { RegistrationDetail } from "../data";

const EXTRA_ROLES = ["leader", "pic"] as const;
type ExtraRole = (typeof EXTRA_ROLES)[number];

export function LoginAccountCard({ detail }: { detail: RegistrationDetail }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [selectedExtraRoles, setSelectedExtraRoles] = useState<Set<ExtraRole>>(
    new Set(detail.portal_roles.filter((r): r is ExtraRole => EXTRA_ROLES.includes(r as ExtraRole)))
  );

  const toggleRole = (role: ExtraRole) => {
    setSelectedExtraRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  if (!detail.has_login) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">登入帐号</p>
          <p className="text-sm text-muted-foreground">
            尚未建立登入帐号。建立后会自动授予「{ROLE_LABEL.agent}」角色，登入邮箱为 {detail.email}。
          </p>

          <div className="space-y-2">
            <Label htmlFor="initial_password">初始密码</Label>
            <Input
              id="initial_password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 个字元"
            />
          </div>

          <div className="space-y-2">
            <Label>额外角色（选填）</Label>
            <div className="flex gap-4">
              {EXTRA_ROLES.map((role) => (
                <label key={role} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={selectedExtraRoles.has(role)}
                    onChange={() => toggleRole(role)}
                  />
                  {ROLE_LABEL[role]}
                </label>
              ))}
            </div>
          </div>

          {message && <p className="text-sm">{message}</p>}

          <Button
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await adminCreateAnalystLogin(detail.analyst_id, password, [...selectedExtraRoles]);
                setMessage(result.message);
                if (result.ok) router.refresh();
              })
            }
          >
            建立登入帐号
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">登入帐号</p>
        <div className="flex flex-wrap gap-1">
          {detail.portal_roles.map((role) => (
            <Badge key={role} variant="secondary">
              {ROLE_LABEL[role]}
            </Badge>
          ))}
        </div>

        <div className="space-y-2">
          <Label>额外角色</Label>
          <div className="flex gap-4">
            {EXTRA_ROLES.map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={selectedExtraRoles.has(role)}
                  onChange={() => toggleRole(role)}
                />
                {ROLE_LABEL[role]}
              </label>
            ))}
          </div>
        </div>

        {message && <p className="text-sm">{message}</p>}

        <Button
          variant="secondary"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await adminUpdateAnalystExtraRoles(detail.analyst_id, [...selectedExtraRoles]);
              setMessage(result.message);
              if (result.ok) router.refresh();
            })
          }
        >
          更新角色
        </Button>
      </CardContent>
    </Card>
  );
}
