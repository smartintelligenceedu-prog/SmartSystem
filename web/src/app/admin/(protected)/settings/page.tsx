import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasRole } from "@/lib/auth/roles";
import { t } from "@/lib/i18n";
import { getCompanyInfo } from "./data";
import { CompanyInfoForm } from "./company-info-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!hasRole(context, "admin")) redirect("/admin");

  const companyInfo = await getCompanyInfo();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      <div className="rounded-lg border p-6">
        <h2 className="mb-4 text-base font-semibold">{t("settings.company.title")}</h2>
        <p className="mb-4 text-xs text-muted-foreground">{t("settings.company.description")}</p>
        <CompanyInfoForm companyInfo={companyInfo} />
      </div>
    </div>
  );
}
