import { notFound, redirect } from "next/navigation";
import { getRegistrationDetail, searchApprovedLeaders } from "../data";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { ReviewPanel } from "./review-panel";

export const dynamic = "force-dynamic";

export default async function RegistrationDetailPage({
  params,
}: {
  params: Promise<{ analystId: string }>;
}) {
  // Same back-office-only gate as the list page — this is the page that
  // shows one specific person's IC/payment documents and bank details.
  const context = await getPortalUserContext();
  if (!isBackOfficeRole(context)) {
    redirect("/admin");
  }

  const { analystId } = await params;
  const [detail, leaders] = await Promise.all([getRegistrationDetail(analystId), searchApprovedLeaders()]);
  if (!detail) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <ReviewPanel detail={detail} leaders={leaders} />
    </div>
  );
}
