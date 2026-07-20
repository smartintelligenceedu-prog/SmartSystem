import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listSalesItems } from "../data";
import { CreateSalesItemForm } from "./create-sales-item-form";
import { ItemRow } from "./item-row";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function SalesItemsPage() {
  const context = await getPortalUserContext();
  if (!isBackOfficeRole(context)) {
    redirect("/admin");
  }

  const items = await listSalesItems();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/admin/sales-orders" className="text-xs text-muted-foreground hover:underline">
            ← {await t("sales_orders.items_page.back_link")}
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{await t("sales_orders.items_page.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{await t("sales_orders.items_page.subtitle")}</p>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("sales_orders.items_page.existing_items")}</h2>
        <div className="divide-y rounded-md border">
          {items.length === 0 && <p className="p-4 text-sm text-muted-foreground">{await t("sales_orders.items_page.empty")}</p>}
          {items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("sales_orders.items_page.add_item")}</h2>
        <CreateSalesItemForm />
      </div>
    </div>
  );
}
