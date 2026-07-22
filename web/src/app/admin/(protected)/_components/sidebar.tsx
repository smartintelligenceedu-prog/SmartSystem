"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import type { PortalUserContext } from "@/lib/auth/context";
import { hasRole, hasAnyRole, isBackOfficeRole } from "@/lib/auth/roles";
import { ct } from "@/lib/i18n-client";

interface NavItem {
  href: string;
  label: string;
}

// Nav items are gated per-role so nothing links to a page that would just
// redirect the visitor away (every gated page re-checks its own access
// independently — this is only about not showing dead links).
export function Sidebar({ context }: { context: PortalUserContext }) {
  const pathname = usePathname();

  const hasAnalyst = !!context.analystId;
  const isLeader = hasRole(context, "leader") && hasAnalyst;
  const isBackOffice = isBackOfficeRole(context);
  const isFinance = hasAnyRole(context, ["admin", "finance"]);
  const isAdmin = hasRole(context, "admin");

  const items: NavItem[] = [
    { href: "/admin", label: ct("dashboard.nav.label") },
    ...(hasAnalyst || context.introducerId || isBackOffice
      ? [{ href: "/admin/customers", label: isBackOffice ? ct("customer.nav.label_back_office") : ct("customer.nav.label") }]
      : []),
    ...(hasAnalyst || isBackOffice ? [{ href: "/admin/sales-orders", label: ct("sales_orders.page.title") }] : []),
    ...(hasAnalyst || isBackOffice ? [{ href: "/admin/schedule", label: ct("schedule.nav.label") }] : []),
    ...(hasAnalyst || isBackOffice ? [{ href: "/admin/leads", label: ct("leads.nav.label") }] : []),
    ...(hasAnalyst ? [{ href: "/admin/reports", label: ct("reports.title.self") }] : isBackOffice ? [{ href: "/admin/reports", label: ct("reports.title.back_office") }] : []),
    ...(hasAnalyst || context.introducerId || isBackOffice ? [{ href: "/admin/commission", label: ct("commission.page.title") }] : []),
    ...(hasAnalyst || context.introducerId || isFinance ? [{ href: "/admin/payroll", label: ct("payroll.nav.label") }] : []),
    ...(hasAnalyst ? [{ href: "/admin/certification", label: ct("certification.nav.label") }] : []),
    ...(isLeader ? [{ href: "/admin/team", label: ct("team.page.title") }] : []),
    ...(isFinance ? [{ href: "/admin/finance", label: ct("finance.page.title") }] : []),
    ...(hasAnalyst && !isFinance ? [{ href: "/admin/finance/institutional", label: ct("finance.institutional.nav.agent_label") }] : []),
    ...(isFinance ? [{ href: "/admin/pic-campaigns", label: ct("pic_campaigns.nav.label") }] : []),
    ...(isFinance ? [{ href: "/admin/analytics", label: ct("analytics.nav.label") }] : []),
    ...(isBackOffice ? [{ href: "/admin/registrations", label: ct("registrations.nav.label") }] : []),
    ...(isBackOffice ? [{ href: "/admin/introducers", label: ct("introducers.page.title") }] : []),
    ...(isBackOffice ? [{ href: "/admin/introducer-applications", label: ct("introducer_applications.page.title") }] : []),
    ...(isBackOffice ? [{ href: "/admin/devices", label: ct("devices.nav.label") }] : []),
    ...(isBackOffice ? [{ href: "/admin/certification/questions", label: ct("certification.nav.admin_label") }] : []),
    ...(isAdmin ? [{ href: "/admin/users", label: ct("users.page.title") }] : []),
    ...(isAdmin ? [{ href: "/admin/settings", label: ct("settings.nav.label") }] : []),
    { href: "/admin/profile", label: ct("profile.page.title") },
  ];

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r px-4 py-5">
      <Logo className="mb-6" />
      <nav className="flex flex-col gap-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-2 py-1.5 text-sm ${
              isActive(item.href)
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
