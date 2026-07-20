import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasAnyRole } from "@/lib/auth/roles";
import { listActiveCommissionRules } from "./data";
import { RuleEditRow } from "./rule-edit-row";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function CommissionRulesPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!hasAnyRole(context, ["admin", "finance"])) redirect("/admin");

  const rules = await listActiveCommissionRules();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{await t("commission.rules.page.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{await t("commission.rules.page.subtitle")}</p>
      </div>

      <div className="divide-y rounded-md border">
        {rules.length === 0 && <p className="p-4 text-sm text-muted-foreground">{await t("commission.rules.page.empty")}</p>}
        {rules.map((rule) => (
          <RuleEditRow key={`${rule.trigger_type}-${rule.level_number}`} rule={rule} />
        ))}
      </div>
    </div>
  );
}
