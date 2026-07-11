import { notFound } from "next/navigation";
import { getRegistrationDetail, searchApprovedLeaders } from "../data";
import { ReviewPanel } from "./review-panel";

export const dynamic = "force-dynamic";

export default async function RegistrationDetailPage({
  params,
}: {
  params: Promise<{ analystId: string }>;
}) {
  const { analystId } = await params;
  const [detail, leaders] = await Promise.all([getRegistrationDetail(analystId), searchApprovedLeaders()]);
  if (!detail) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <ReviewPanel detail={detail} leaders={leaders} />
    </div>
  );
}
