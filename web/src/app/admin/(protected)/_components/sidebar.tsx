"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";

interface NavItem {
  href: string;
  label: string;
}

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/registrations", label: "注册审核" },
    ...(isAdmin ? [{ href: "/admin/users", label: "帐号管理" }] : []),
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
