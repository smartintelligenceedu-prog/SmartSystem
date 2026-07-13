import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasAnyRole } from "@/lib/auth/roles";
import { listActiveCommissionRules } from "./data";
import { RuleEditRow } from "./rule-edit-row";

export const dynamic = "force-dynamic";

export default async function CommissionRulesPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!hasAnyRole(context, ["admin", "finance"])) redirect("/admin");

  const rules = await listActiveCommissionRules();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">佣金规则设定</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          调整后不会改动已经算出来的佣金记录，只影响调整日期之后新计算的佣金——每次调整都会保留旧规则的生效区间，方便追溯。
        </p>
      </div>

      <div className="divide-y rounded-md border">
        {rules.length === 0 && <p className="p-4 text-sm text-muted-foreground">找不到生效中的佣金规则</p>}
        {rules.map((rule) => (
          <RuleEditRow key={`${rule.trigger_type}-${rule.level_number}`} rule={rule} />
        ))}
      </div>
    </div>
  );
}
