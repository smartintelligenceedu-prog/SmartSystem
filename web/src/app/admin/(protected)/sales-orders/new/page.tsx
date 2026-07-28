import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasRole } from "@/lib/auth/roles";
import { listOwnCustomersForPicker, listOwnRedeemableVouchers, listApprovedAgents, listActiveSalesItems } from "../data";
import { NewSalesOrderForm } from "./new-sales-order-form";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";
// Same reasoning as /register/page.tsx — a real payment-screenshot photo on
// a slow mobile connection can outrun the platform's default Server Action
// timeout.
export const maxDuration = 60;

export default async function NewSalesOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; voucher_id?: string }>;
}) {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!context.analystId) redirect("/admin");

  // Admin sees every active customer here, not just ones they personally
  // own — every other analyst stays scoped to their own.
  const isAdmin = hasRole(context, "admin");

  const [customers, vouchers, agents, salesItems, params] = await Promise.all([
    listOwnCustomersForPicker(context.analystId, isAdmin),
    listOwnRedeemableVouchers(context.analystId),
    listApprovedAgents(),
    listActiveSalesItems(),
    searchParams,
  ]);

  // Lets /admin/vouchers's "转售" button jump straight into this form with
  // redeem_voucher mode and the specific voucher already selected, instead
  // of making the analyst re-pick it from the dropdown themselves.
  const defaultMode = params.mode === "redeem_voucher" ? "redeem_voucher" : "pay_now";
  const defaultVoucherId = params.voucher_id && vouchers.some((v) => v.id === params.voucher_id) ? params.voucher_id : undefined;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{await t("sales_orders.new_page.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{await t("sales_orders.new_page.subtitle")}</p>
      </div>
      <NewSalesOrderForm
        ownAnalystId={context.analystId}
        ownAnalystName={context.fullName}
        customers={customers}
        agents={agents}
        vouchers={vouchers}
        salesItems={salesItems}
        defaultMode={defaultMode}
        defaultVoucherId={defaultVoucherId}
      />
    </div>
  );
}
