import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listSalesItems } from "../data";
import { CreateSalesItemForm } from "./create-sales-item-form";
import { ItemRow } from "./item-row";

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
            ← 返回销售订单
          </Link>
          <h1 className="mt-1 text-xl font-semibold">销售项目 / 价目表</h1>
          <p className="mt-1 text-sm text-muted-foreground">建立销售订单时可以从这里选择项目，价格会自动预填（仍可手动改）。</p>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">现有项目</h2>
        <div className="divide-y rounded-md border">
          {items.length === 0 && <p className="p-4 text-sm text-muted-foreground">尚未建立任何销售项目</p>}
          {items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">新增项目</h2>
        <CreateSalesItemForm />
      </div>
    </div>
  );
}
