import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { SubmitLeadForm } from "./submit-lead-form";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function SubmitLeadPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!context.introducerId) redirect("/admin");

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{await t("leads.submit.page.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{await t("leads.submit.page.subtitle")}</p>
      </div>
      <SubmitLeadForm />
    </div>
  );
}
