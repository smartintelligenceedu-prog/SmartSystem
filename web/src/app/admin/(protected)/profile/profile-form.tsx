"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateOwnName, changeOwnPassword } from "./actions";
import type { PortalUserContext } from "@/lib/auth/context";
import { ROLE_LABEL } from "@/lib/auth/roles";

export function ProfileForm({ context }: { context: PortalUserContext }) {
  const [isPending, startTransition] = useTransition();
  const [fullName, setFullName] = useState(context.fullName);
  const [nameMessage, setNameMessage] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

  return (
    <div className="mt-6 space-y-6">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">基本资料</p>

          <div className="space-y-2">
            <Label>电邮</Label>
            <p className="text-sm text-muted-foreground">{context.email}</p>
          </div>

          <div className="space-y-2">
            <Label>角色</Label>
            <div className="flex gap-1">
              {context.roles.map((role) => (
                <Badge key={role} variant="secondary">
                  {ROLE_LABEL[role]}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="full_name">姓名</Label>
            <Input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>

          {nameMessage && <p className="text-sm">{nameMessage}</p>}

          <Button
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await updateOwnName(fullName);
                setNameMessage(result.message);
              })
            }
          >
            储存
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">更改密码</p>
          <div className="space-y-2">
            <Label htmlFor="new_password">新密码</Label>
            <Input
              id="new_password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="至少 8 个字元"
            />
          </div>
          {passwordMessage && <p className="text-sm">{passwordMessage}</p>}
          <Button
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await changeOwnPassword(newPassword);
                setPasswordMessage(result.message);
                if (result.ok) setNewPassword("");
              })
            }
          >
            更新密码
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
