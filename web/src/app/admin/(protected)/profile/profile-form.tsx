"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateOwnName, changeOwnPassword } from "./actions";
import type { PortalUserContext } from "@/lib/auth/context";
import type { PortalRole } from "@/lib/auth/roles";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ct } from "@/lib/i18n-client";

const ROLE_KEY: Record<PortalRole, "role.admin" | "role.finance" | "role.back_office" | "role.agent" | "role.leader" | "role.introducer" | "role.pic"> = {
  admin: "role.admin",
  finance: "role.finance",
  back_office: "role.back_office",
  agent: "role.agent",
  leader: "role.leader",
  introducer: "role.introducer",
  pic: "role.pic",
};

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
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("profile.language_heading")}</p>
          <LocaleSwitcher />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("profile.basic_info_heading")}</p>

          <div className="space-y-2">
            <Label>{ct("profile.field.email")}</Label>
            <p className="text-sm text-muted-foreground">{context.email}</p>
          </div>

          <div className="space-y-2">
            <Label>{ct("profile.field.roles")}</Label>
            <div className="flex gap-1">
              {context.roles.map((role) => (
                <Badge key={role} variant="secondary">
                  {ct(ROLE_KEY[role])}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="full_name">{ct("profile.field.full_name")}</Label>
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
            {ct("profile.save")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("profile.change_password_heading")}</p>
          <div className="space-y-2">
            <Label htmlFor="new_password">{ct("profile.field.new_password")}</Label>
            <Input
              id="new_password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={ct("profile.field.new_password_placeholder")}
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
            {ct("profile.update_password")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
