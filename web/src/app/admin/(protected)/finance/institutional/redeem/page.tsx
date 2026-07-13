import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { RedeemForm } from "./redeem-form";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// Front-line page — any logged-in analyst can redeem a voucher while
// physically running a detection session, not just back office (mirrors
// reports/page.tsx's permission model, not the back-office-only gate used
// by the rest of finance/institutional/).
export default async function RedeemVoucherPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  const isBackOffice = isBackOfficeRole(context);
  if (!context.analystId && !isBackOffice) redirect("/admin");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t("finance.institutional.voucher.redeem_page_title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("finance.institutional.voucher.redeem_page_subtitle")}</p>
      </div>
      <RedeemForm />
    </div>
  );
}
