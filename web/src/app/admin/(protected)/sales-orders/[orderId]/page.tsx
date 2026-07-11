import { redirect, notFound } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { getSalesOrderDetail } from "../data";
import { ReviewPanel } from "./review-panel";

export const dynamic = "force-dynamic";

export default async function SalesOrderReviewPage({ params }: { params: Promise<{ orderId: string }> }) {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!isBackOfficeRole(context)) redirect("/admin");

  const { orderId } = await params;
  const detail = await getSalesOrderDetail(orderId);
  if (!detail) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <ReviewPanel detail={detail} />
    </div>
  );
}
