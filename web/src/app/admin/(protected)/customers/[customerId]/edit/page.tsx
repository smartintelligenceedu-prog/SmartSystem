import { redirect, notFound } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { getCustomerDetail, listCustomerChildren, listActiveIntroducersForAttribution } from "../../data";
import { CustomerForm } from "../../customer-form";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function EditCustomerPage({ params }: { params: Promise<{ customerId: string }> }) {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");

  const { customerId } = await params;
  const detail = await getCustomerDetail(customerId);
  if (!detail) notFound();

  const isBackOffice = isBackOfficeRole(context);
  if (!isBackOffice && detail.owner_analyst_id !== context.analystId) redirect("/admin/customers");

  const [children, introducers] = await Promise.all([listCustomerChildren(customerId), listActiveIntroducersForAttribution()]);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t("customer.form.edit_title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("customer.form.edit_subtitle")}</p>
      </div>
      <CustomerForm
        mode="edit"
        customerId={customerId}
        introducers={introducers}
        initialValues={{
          full_name: detail.full_name === "—" ? "" : detail.full_name,
          phone: detail.phone ?? "",
          email: detail.email ?? "",
          gender: detail.gender ?? "",
          date_of_birth: detail.date_of_birth ?? "",
          occupation: detail.occupation ?? "",
          marital_status: detail.marital_status ?? "",
          acquired_via_introducer_id: detail.acquired_via_introducer_id ?? "",
          children: children.map((c) => ({
            full_name: c.full_name,
            gender: c.gender ?? "",
            date_of_birth: c.date_of_birth ?? "",
            school: c.school ?? "",
            remark: c.remark ?? "",
          })),
        }}
      />
    </div>
  );
}
