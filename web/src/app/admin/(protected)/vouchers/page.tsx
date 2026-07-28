import { redirect } from "next/navigation";
import Link from "next/link";
import { getPortalUserContext } from "@/lib/auth/context";
import { listMyVouchers } from "./data";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const TYPE_KEY = {
  self_use: "vouchers.type.self_use",
  resale: "vouchers.type.resale",
} as const;

const STATUS_KEY = {
  locked: "vouchers.status.locked",
  issued: "vouchers.status.issued",
  redeemed: "vouchers.status.redeemed",
  expired: "vouchers.status.expired",
} as const;

const STATUS_BADGE_VARIANT = {
  locked: "outline",
  issued: "secondary",
  redeemed: "outline",
  expired: "outline",
} as const;

export default async function VouchersPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!context.analystId) redirect("/admin");

  const vouchers = await listMyVouchers(context.analystId);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{await t("vouchers.page.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{await t("vouchers.page.subtitle")}</p>
      </div>

      {vouchers.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{await t("vouchers.empty")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {vouchers.map((v) => (
            <Card key={v.id}>
              <CardContent className="flex flex-col gap-2 pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant={v.voucher_type === "self_use" ? "secondary" : "default"}>{t(TYPE_KEY[v.voucher_type])}</Badge>
                    <Badge variant={STATUS_BADGE_VARIANT[v.status]}>{t(STATUS_KEY[v.status])}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t("vouchers.column.issued_at")}
                    {new Date(v.issued_at).toLocaleDateString("zh-CN")}
                  </span>
                </div>

                {v.status === "locked" && <p className="text-xs text-muted-foreground">{t("vouchers.locked_hint")}</p>}

                {v.status === "redeemed" && v.redeemed_at && (
                  <p className="text-xs text-muted-foreground">
                    {t("vouchers.column.redeemed_at")}
                    {new Date(v.redeemed_at).toLocaleDateString("zh-CN")}
                  </p>
                )}

                {v.status === "issued" && v.voucher_type === "self_use" && (
                  <div className="space-y-1">
                    <Button size="sm" variant="outline" render={<Link href="/admin/customers">{t("vouchers.self_use.action")}</Link>} />
                    <p className="text-xs text-muted-foreground">{t("vouchers.self_use.hint")}</p>
                  </div>
                )}

                {v.status === "issued" && v.voucher_type === "resale" && (
                  <div className="space-y-1">
                    <Button
                      size="sm"
                      render={<Link href={`/admin/sales-orders/new?mode=redeem_voucher&voucher_id=${v.id}`}>{t("vouchers.resale.action")}</Link>}
                    />
                    <p className="text-xs text-muted-foreground">{t("vouchers.resale.hint")}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
