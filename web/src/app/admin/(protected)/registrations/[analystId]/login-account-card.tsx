"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { adminCreateAnalystLogin, adminUpdateAnalystExtraRoles } from "../actions";
import type { PortalRole } from "@/lib/auth/roles";
import type { RegistrationDetail } from "../data";
import { ct } from "@/lib/i18n-client";

const EXTRA_ROLES = ["leader", "pic"] as const;
type ExtraRole = (typeof EXTRA_ROLES)[number];

const ROLE_KEY: Record<PortalRole, "role.admin" | "role.finance" | "role.back_office" | "role.agent" | "role.leader" | "role.introducer" | "role.pic"> = {
  admin: "role.admin",
  finance: "role.finance",
  back_office: "role.back_office",
  agent: "role.agent",
  leader: "role.leader",
  introducer: "role.introducer",
  pic: "role.pic",
};

export function LoginAccountCard({ detail }: { detail: RegistrationDetail }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
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
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("registrations.login.heading")}</p>
          <p className="text-sm text-muted-foreground">
            {ct("registrations.login.no_login_prefix")}{ct(ROLE_KEY.agent)}{ct("registrations.login.no_login_middle")}{detail.email}{ct("registrations.login.no_login_suffix")}
          </p>
          <p className="text-sm text-muted-foreground">{ct("registrations.login.password_auto_note")}</p>

          <div className="space-y-2">
            <Label>{ct("registrations.login.extra_roles_label_optional")}</Label>
            <div className="flex gap-4">
              {EXTRA_ROLES.map((role) => (
                <label key={role} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={selectedExtraRoles.has(role)}
                    onChange={() => toggleRole(role)}
                  />
                  {ct(ROLE_KEY[role])}
                </label>
              ))}
            </div>
          </div>

          {message && <p className="text-sm">{message}</p>}

          <Button
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await adminCreateAnalystLogin(detail.analyst_id, [...selectedExtraRoles]);
                setMessage(result.message);
                if (result.ok) router.refresh();
              })
            }
          >
            {ct("registrations.login.create_button")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("registrations.login.heading")}</p>
        <div className="flex flex-wrap gap-1">
          {detail.portal_roles.map((role) => (
            <Badge key={role} variant="secondary">
              {ct(ROLE_KEY[role])}
            </Badge>
          ))}
        </div>

        <div className="space-y-2">
          <Label>{ct("registrations.login.extra_roles_label")}</Label>
          <div className="flex gap-4">
            {EXTRA_ROLES.map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={selectedExtraRoles.has(role)}
                  onChange={() => toggleRole(role)}
                />
                {ct(ROLE_KEY[role])}
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
          {ct("registrations.login.update_button")}
        </Button>
      </CardContent>
    </Card>
  );
}
