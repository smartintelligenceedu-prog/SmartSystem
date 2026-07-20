import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { ProfileForm } from "./profile-form";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-xl font-semibold">{await t("profile.page.title")}</h1>
      <ProfileForm context={context} />
    </div>
  );
}
