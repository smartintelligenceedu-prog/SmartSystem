import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { getMarketingVoucherDetail } from "../data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RedeemButton } from "./redeem-button";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function VoucherDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");

  const canManage = isBackOfficeRole(context);
  if (!canManage && !context.introducerId) redirect("/admin");

  const { id } = await params;
  const voucher = await getMarketingVoucherDetail(id, context.introducerId);
  if (!voucher || (!voucher.is_active && !canManage)) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Button size="sm" variant="ghost" render={<Link href="/admin/voucher-portal">{await t("voucher_portal.detail.back_link")}</Link>} />

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="aspect-video w-full overflow-hidden bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={voucher.image_url} alt={voucher.title} className="h-full w-full object-cover" />
        </div>
        <div className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-lg font-semibold">{voucher.title}</h1>
            {canManage && (
              <Badge variant={voucher.is_active ? "secondary" : "outline"}>
                {voucher.is_active ? await t("voucher_portal.status.active") : await t("voucher_portal.status.inactive")}
              </Badge>
            )}
          </div>

          {voucher.terms && (
            <div className="space-y-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {await t("voucher_portal.form.terms_label")}
              </p>
              <p className="whitespace-pre-line text-sm text-muted-foreground">{voucher.terms}</p>
            </div>
          )}

          {context.introducerId &&
            (voucher.redeemed_at ? (
              <p className="text-sm text-muted-foreground">
                {await t("voucher_portal.detail.redeemed_at_prefix")}
                {new Date(voucher.redeemed_at).toLocaleString("zh-CN")}
              </p>
            ) : (
              <RedeemButton voucherId={voucher.id} />
            ))}
        </div>
      </div>
    </div>
  );
}
