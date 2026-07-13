"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import type { PortalUserContext } from "@/lib/auth/context";
import { hasRole, hasAnyRole, isBackOfficeRole } from "@/lib/auth/roles";
import { t } from "@/lib/i18n";

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
    { href: "/admin", label: "Dashboard" },
    ...(hasAnalyst || context.introducerId || isBackOffice
      ? [{ href: "/admin/customers", label: isBackOffice ? t("customer.nav.label_back_office") : t("customer.nav.label") }]
      : []),
    ...(hasAnalyst || isBackOffice ? [{ href: "/admin/sales-orders", label: "销售订单" }] : []),
    ...(hasAnalyst ? [{ href: "/admin/reports", label: "我的报告" }] : isBackOffice ? [{ href: "/admin/reports", label: "报告交付状态" }] : []),
    ...(hasAnalyst || context.introducerId || isBackOffice ? [{ href: "/admin/commission", label: "佣金" }] : []),
    ...(isLeader ? [{ href: "/admin/team", label: "团队" }] : []),
    ...(isFinance ? [{ href: "/admin/finance", label: "财务" }] : []),
    ...(isFinance ? [{ href: "/admin/analytics", label: t("analytics.nav.label") }] : []),
    ...(isBackOffice ? [{ href: "/admin/registrations", label: "注册审核" }] : []),
    ...(isBackOffice ? [{ href: "/admin/introducers", label: "引荐人管理" }] : []),
    ...(isAdmin ? [{ href: "/admin/users", label: "帐号管理" }] : []),
    ...(isAdmin ? [{ href: "/admin/settings", label: "设定" }] : []),
    { href: "/admin/profile", label: "我的帐户" },
  ];

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r px-4 py-5">
      <Logo className="mb-6 px-2" />
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
