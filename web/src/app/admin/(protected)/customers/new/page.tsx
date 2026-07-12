import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { listActiveIntroducersForAttribution } from "../data";
import { CustomerForm } from "../customer-form";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!context.analystId) redirect("/admin");

  const introducers = await listActiveIntroducersForAttribution();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t("customer.form.create_title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("customer.form.create_subtitle")}</p>
      </div>
      <CustomerForm mode="create" introducers={introducers} />
    </div>
  );
}
