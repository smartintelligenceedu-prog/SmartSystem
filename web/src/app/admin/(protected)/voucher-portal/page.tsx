import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listMarketingVouchers, listActiveMarketingVouchers } from "./data";
import { CreateVoucherForm } from "./create-voucher-form";
import { VoucherCard } from "./voucher-card";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function VoucherPortalPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");

  const canManage = isBackOfficeRole(context);
  const vouchers = canManage ? await listMarketingVouchers() : await listActiveMarketingVouchers();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{await t("voucher_portal.page.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{await t("voucher_portal.page.subtitle")}</p>
      </div>

      {canManage && (
        <div>
          <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">
            {await t("voucher_portal.form.create_title")}
          </h2>
          <CreateVoucherForm />
        </div>
      )}

      {vouchers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {canManage ? await t("voucher_portal.page.empty") : await t("voucher_portal.page.gallery_empty")}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {vouchers.map((v) => (
            <VoucherCard key={v.id} voucher={v} canManage={canManage} />
          ))}
        </div>
      )}
    </div>
  );
}
