import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { listActiveIntroducersForAttribution } from "../data";
import { NewCustomerForm } from "./new-customer-form";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!context.analystId) redirect("/admin");

  const introducers = await listActiveIntroducersForAttribution();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-semibold">登记新顾客</h1>
        <p className="mt-1 text-sm text-muted-foreground">为你名下新增一位顾客。</p>
      </div>
      <NewCustomerForm introducers={introducers} />
    </div>
  );
}
