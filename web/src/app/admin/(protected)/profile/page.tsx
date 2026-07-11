import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-xl font-semibold">我的帐户</h1>
      <ProfileForm context={context} />
    </div>
  );
}
