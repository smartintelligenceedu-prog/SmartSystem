import { redirect, notFound } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { getIntroducerDetail } from "../data";
import { EditIntroducerInfoForm } from "./edit-introducer-info-form";
import { IntroducerLoginAccountCard } from "./introducer-login-account-card";
import { BackButton } from "../../_components/back-button";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function IntroducerDetailPage({ params }: { params: Promise<{ introducerId: string }> }) {
  const context = await getPortalUserContext();
  if (!isBackOfficeRole(context)) redirect("/admin");

  const { introducerId } = await params;
  const detail = await getIntroducerDetail(introducerId);
  if (!detail) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <BackButton />
        <h1 className="mt-1 text-xl font-semibold">{detail.full_name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{await t("introducers.detail.subtitle")}</p>
      </div>

      <EditIntroducerInfoForm detail={detail} />
      <IntroducerLoginAccountCard detail={detail} />
    </div>
  );
}
