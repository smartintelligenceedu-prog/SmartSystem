import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

// Back office's "what's new" glance — refreshes on page load like the rest
// of this app (no websocket/real-time layer), same philosophy as the
// existing per-page pending counts. Zero-JS dropdown via <details>/<summary>.
export async function NotificationsBell() {
  const admin = createAdminClient();
  const [{ count: pendingSalesOrders }, { count: pendingRegistrations }] = await Promise.all([
    admin.from("sales_orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("analysts").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  const total = (pendingSalesOrders ?? 0) + (pendingRegistrations ?? 0);

  const [salesOrdersLabel, registrationsLabel] = await Promise.all([
    t("notifications.pending_sales_orders"),
    t("notifications.pending_registrations"),
  ]);

  return (
    <details className="relative">
      <summary className="relative flex size-8 cursor-pointer list-none items-center justify-center rounded-md text-lg hover:bg-accent/50 [&::-webkit-details-marker]:hidden">
        🔔
        {total > 0 && (
          <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
            {total}
          </span>
        )}
      </summary>
      <div className="absolute right-0 z-10 mt-2 w-64 rounded-md border bg-popover p-2 text-sm shadow-lg">
        {total === 0 && <p className="p-2 text-muted-foreground">{await t("notifications.empty")}</p>}
        {(pendingSalesOrders ?? 0) > 0 && (
          <Link href="/admin/sales-orders?status=pending" className="block rounded-md px-2 py-1.5 hover:bg-accent/50">
            {salesOrdersLabel}
            <span className="ml-1 font-medium">{pendingSalesOrders}</span>
          </Link>
        )}
        {(pendingRegistrations ?? 0) > 0 && (
          <Link href="/admin/registrations" className="block rounded-md px-2 py-1.5 hover:bg-accent/50">
            {registrationsLabel}
            <span className="ml-1 font-medium">{pendingRegistrations}</span>
          </Link>
        )}
      </div>
    </details>
  );
}
