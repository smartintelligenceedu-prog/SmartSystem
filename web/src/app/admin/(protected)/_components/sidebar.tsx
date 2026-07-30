"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";
import { Logo } from "@/components/logo";
import type { PortalUserContext } from "@/lib/auth/context";
import { hasRole, hasAnyRole, isBackOfficeRole } from "@/lib/auth/roles";
import { ct } from "@/lib/i18n-client";

interface NavItem {
  href: string;
  label: string;
}

type GroupKey = "business" | "partnership" | "team" | "finance" | "system";

const GROUP_LABEL_KEY: Record<GroupKey, Parameters<typeof ct>[0]> = {
  business: "nav.group.business",
  partnership: "nav.group.partnership",
  team: "nav.group.team",
  finance: "nav.group.finance",
  system: "nav.group.system",
};

const GROUP_ORDER: GroupKey[] = ["business", "partnership", "team", "finance", "system"];

// Nav items are gated per-role so nothing links to a page that would just
// redirect the visitor away (every gated page re-checks its own access
// independently — this is only about not showing dead links). Dashboard and
// Profile sit outside the 6 collapsible groups: every role always has
// exactly those two, so grouping them adds a click for no filtering benefit.
export function Sidebar({ context }: { context: PortalUserContext }) {
  const pathname = usePathname();

  const hasAnalyst = !!context.analystId;
  const isLeader = hasRole(context, "leader") && hasAnalyst;
  const isBackOffice = isBackOfficeRole(context);
  const isFinance = hasAnyRole(context, ["admin", "finance"]);
  const isAdmin = hasRole(context, "admin");

  const dashboardItem: NavItem = { href: "/admin", label: ct("dashboard.nav.label") };
  const profileItem: NavItem = { href: "/admin/profile", label: ct("profile.page.title") };

  const groupItems: Record<GroupKey, NavItem[]> = {
    business: [
      ...(hasAnalyst || context.introducerId || isBackOffice
        ? [{ href: "/admin/customers", label: isBackOffice ? ct("customer.nav.label_back_office") : ct("customer.nav.label") }]
        : []),
      ...(hasAnalyst || isBackOffice ? [{ href: "/admin/leads", label: ct("leads.nav.label") }] : []),
      ...(hasAnalyst || isBackOffice ? [{ href: "/admin/sales-orders", label: ct("sales_orders.page.title") }] : []),
      ...(hasAnalyst ? [{ href: "/admin/vouchers", label: ct("vouchers.nav.label") }] : []),
      ...(hasAnalyst ? [{ href: "/admin/reports", label: ct("reports.title.self") }] : isBackOffice ? [{ href: "/admin/reports", label: ct("reports.title.back_office") }] : []),
      ...(hasAnalyst && !isFinance ? [{ href: "/admin/finance/institutional", label: ct("finance.institutional.nav.agent_label") }] : []),
    ],
    partnership: [
      ...(isBackOffice ? [{ href: "/admin/introducers", label: ct("introducers.page.title") }] : []),
      ...(isBackOffice ? [{ href: "/admin/introducer-applications", label: ct("introducer_applications.page.title") }] : []),
      ...(isFinance ? [{ href: "/admin/pic-campaigns", label: ct("pic_campaigns.nav.label") }] : []),
    ],
    team: [
      ...(isLeader ? [{ href: "/admin/team", label: ct("team.page.title") }] : []),
      ...(hasAnalyst || isBackOffice ? [{ href: "/admin/schedule", label: ct("schedule.nav.label") }] : []),
      ...(hasAnalyst ? [{ href: "/admin/certification", label: ct("certification.nav.label") }] : []),
    ],
    finance: [
      ...(isFinance ? [{ href: "/admin/finance", label: ct("finance.page.title") }] : []),
      ...(hasAnalyst || context.introducerId || isBackOffice ? [{ href: "/admin/commission", label: ct("commission.page.title") }] : []),
      ...(hasAnalyst || context.introducerId || isFinance ? [{ href: "/admin/payroll", label: ct("payroll.nav.label") }] : []),
      ...(isFinance ? [{ href: "/admin/analytics", label: ct("analytics.nav.label") }] : []),
    ],
    system: [
      ...(isBackOffice ? [{ href: "/admin/registrations", label: ct("registrations.nav.label") }] : []),
      ...(isAdmin ? [{ href: "/admin/users", label: ct("users.page.title") }] : []),
      ...(isBackOffice ? [{ href: "/admin/devices", label: ct("devices.nav.label") }] : []),
      ...(isBackOffice ? [{ href: "/admin/certification/questions", label: ct("certification.nav.admin_label") }] : []),
      ...(isAdmin ? [{ href: "/admin/settings", label: ct("settings.nav.label") }] : []),
    ],
  };

  const visibleGroups = GROUP_ORDER.filter((key) => groupItems[key].length > 0);

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));
  const activeGroup = visibleGroups.find((key) => groupItems[key].some((item) => isActive(item.href)));

  const [expanded, setExpanded] = useState<Set<GroupKey>>(() => new Set(activeGroup ? [activeGroup] : []));

  // Auto-open whichever group holds the current route on navigation, without
  // collapsing groups the user already opened manually.
  useEffect(() => {
    if (activeGroup) setExpanded((prev) => (prev.has(activeGroup) ? prev : new Set(prev).add(activeGroup)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggleGroup = (key: GroupKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const linkClassName = (href: string) =>
    `rounded-md px-2 py-1.5 text-sm ${
      isActive(href)
        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
    }`;

  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar px-4 py-5">
      <div className="mb-6 rounded-lg bg-white p-2">
        <Logo />
      </div>
      <nav className="flex flex-col gap-1">
        <Link href={dashboardItem.href} className={linkClassName(dashboardItem.href)}>
          {dashboardItem.label}
        </Link>
        {visibleGroups.map((key) => {
          const isOpen = expanded.has(key);
          return (
            <div key={key} className="flex flex-col">
              <button
                type="button"
                onClick={() => toggleGroup(key)}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                aria-expanded={isOpen}
              >
                {ct(GROUP_LABEL_KEY[key])}
                <ChevronDownIcon className={`size-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {isOpen && (
                <div className="ml-2 flex flex-col gap-1 border-l border-sidebar-border pl-2">
                  {groupItems[key].map((item) => (
                    <Link key={item.href} href={item.href} className={linkClassName(item.href)}>
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <Link href={profileItem.href} className={linkClassName(profileItem.href)}>
          {profileItem.label}
        </Link>
      </nav>
    </aside>
  );
}
