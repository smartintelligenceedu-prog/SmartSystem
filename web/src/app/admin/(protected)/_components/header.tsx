import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOut } from "../../login/actions";
import { NotificationsBell } from "./notifications-bell";
import { NotificationsAutoRefresh } from "./notifications-auto-refresh";
import { listDeviceScheduleForDate } from "../_scheduling/data";
import type { PortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole, type PortalRole } from "@/lib/auth/roles";
import { t, type TranslationKey } from "@/lib/i18n";

// Malaysia has a single fixed UTC+8 offset (no DST) — same local helper
// pattern used by every other module that needs "today" (see schedule/
// page.tsx's own todayDateString()).
function todayDateStringMY(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

const ROLE_KEY: Record<PortalRole, TranslationKey> = {
  admin: "role.admin",
  finance: "role.finance",
  back_office: "role.back_office",
  agent: "role.agent",
  leader: "role.leader",
  introducer: "role.introducer",
  pic: "role.pic",
  machine_assessor: "role.machine_assessor",
};

export async function Header({ context }: { context: PortalUserContext }) {
  const roleLabelByRole = Object.fromEntries(
    await Promise.all(Object.entries(ROLE_KEY).map(async ([k, key]) => [k, await t(key)]))
  ) as Record<PortalRole, string>;

  // Same access gate as /admin/schedule itself (context.analystId or back
  // office) — no point showing a device-status strip that links to a page
  // the viewer can't open. Fetched on every page load since this renders in
  // the shared layout; the devices table is small (a handful of machines),
  // so this stays cheap.
  const canSeeDeviceStatus = !!context.analystId || isBackOfficeRole(context);
  const deviceGroups = canSeeDeviceStatus ? await listDeviceScheduleForDate(todayDateStringMY()) : [];
  const freeBadge = canSeeDeviceStatus ? await t("schedule.status_section.free_badge") : "";
  const bookedSuffix = canSeeDeviceStatus ? await t("schedule.status_section.booked_badge_suffix") : "";

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-white px-6 py-3 print:hidden">
      <div className="flex flex-wrap items-center gap-1.5">
        {deviceGroups.map((g) => {
          const isFree = g.slots.length === 0;
          return (
            <Link
              key={g.device_id}
              href={`/admin/schedule#device-${g.device_id}`}
              className={`rounded-full border px-2 py-1 text-xs font-medium transition-colors ${
                isFree
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
              }`}
            >
              {g.device_label} · {isFree ? freeBadge : `${g.slots.length}${bookedSuffix}`}
            </Link>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        {isBackOfficeRole(context) && (
          <>
            <NotificationsAutoRefresh />
            <NotificationsBell />
          </>
        )}
        <div className="text-right">
          <p className="text-sm font-medium leading-tight">{context.fullName}</p>
          <p className="text-xs text-muted-foreground leading-tight">{context.email}</p>
        </div>
        <div className="flex gap-1">
          {context.roles.map((role) => (
            <Badge key={role} variant="secondary">
              {roleLabelByRole[role]}
            </Badge>
          ))}
        </div>
        <form action={signOut}>
          <Button variant="ghost" size="sm" type="submit">
            {await t("header.sign_out")}
          </Button>
        </form>
      </div>
    </header>
  );
}
