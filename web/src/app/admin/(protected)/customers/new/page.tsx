import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { listActiveIntroducersForAttribution } from "../data";
import { getLeadForConversion } from "../../leads/data";
import { CustomerForm, type CustomerFormInitialValues } from "../customer-form";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage({ searchParams }: { searchParams: Promise<{ lead_id?: string }> }) {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!context.analystId) redirect("/admin");

  const { lead_id } = await searchParams;
  const [introducers, lead] = await Promise.all([
    listActiveIntroducersForAttribution(),
    lead_id ? getLeadForConversion(lead_id) : Promise.resolve(null),
  ]);

  // Already-converted leads shouldn't be prefilled again — the analyst's own
  // RLS session also can't see a lead assigned to someone else, so a null
  // `lead` here just means "not usable," and this silently falls back to a
  // blank form rather than erroring.
  const initialValues: CustomerFormInitialValues | undefined =
    lead && lead.status !== "converted"
      ? {
          full_name: lead.contact_name,
          phone: lead.phone ?? undefined,
          acquired_via_introducer_id: lead.introducer_id ?? undefined,
        }
      : undefined;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t("customer.form.create_title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("customer.form.create_subtitle")}</p>
      </div>
      <CustomerForm mode="create" introducers={introducers} initialValues={initialValues} leadId={initialValues ? lead_id : undefined} />
    </div>
  );
}
