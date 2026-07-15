import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import {
  getCustomerDetail,
  listCustomerChildren,
  listCustomerTimeline,
  listCustomerOrders,
  listCustomerCommissions,
} from "../data";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { TQC_TAG_I18N_KEY } from "@/lib/tqc-tags";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("zh-CN") : "—";
}

function ageFromDob(dob: string | null): string {
  if (!dob) return t("customer.child.age_unknown");
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age--;
  return String(age);
}

const ITEM_TYPE_LABEL: Record<string, string> = {
  detection_session: "检测服务（现场付款）",
  voucher_redemption: "检测券兑换",
};
const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  paid: "已付款",
  cancelled: "已取消",
  refunded: "已退款",
};
const TRIGGER_LABEL: Record<string, string> = {
  personal_sale: "个人销售",
  pic_channel: "通路销售（PIC）",
  introducer: "引荐人佣金",
  recruitment: "招募佣金",
  voucher_resale: "兑换券转售",
  report_override: "报告上线抽成",
  analyst_report_fee: "分析师解读费",
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value || "—"}</p>
    </div>
  );
}

export default async function CustomerDetailPage({ params }: { params: Promise<{ customerId: string }> }) {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");

  const { customerId } = await params;
  const detail = await getCustomerDetail(customerId);
  if (!detail) notFound();

  const isBackOffice = isBackOfficeRole(context);
  const canView =
    isBackOffice || detail.owner_analyst_id === context.analystId || (context.introducerId && detail.acquired_via_introducer_id === context.introducerId);
  if (!canView) redirect("/admin/customers");

  const canEdit = isBackOffice || detail.owner_analyst_id === context.analystId;

  const [children, timeline, orders, commissions] = await Promise.all([
    listCustomerChildren(customerId),
    listCustomerTimeline(customerId),
    listCustomerOrders(customerId),
    listCustomerCommissions(customerId),
  ]);

  const reportEligibleOrders = orders.filter((o) => o.status === "paid");
  const deliveredCount = reportEligibleOrders.filter((o) => o.report_delivered_at).length;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/admin/customers" className="text-xs text-muted-foreground hover:underline">
            ← {t("customer.detail.back_to_list")}
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{detail.full_name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={detail.status === "active" ? "secondary" : "outline"}>
            {detail.status === "active" ? t("customer.status.active") : t("customer.status.inactive")}
          </Badge>
          {canEdit && <Button size="sm" render={<Link href={`/admin/customers/${customerId}/edit`}>{t("customer.detail.edit_button")}</Link>} />}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("customer.detail.section.profile")}</h2>
        <Card>
          <CardContent className="grid grid-cols-2 gap-4 pt-6 md:grid-cols-3">
            <Field label={t("customer.field.phone")} value={detail.phone ?? ""} />
            <Field label={t("customer.field.email")} value={detail.email ?? ""} />
            <Field
              label={t("customer.field.gender")}
              value={detail.gender ? t(`customer.field.gender.${detail.gender}` as Parameters<typeof t>[0]) : ""}
            />
            <Field label={t("customer.field.date_of_birth")} value={formatDate(detail.date_of_birth)} />
            <Field label={t("customer.field.occupation")} value={detail.occupation ?? ""} />
            <Field
              label={t("customer.field.marital_status")}
              value={detail.marital_status ? t(`customer.field.marital_status.${detail.marital_status}` as Parameters<typeof t>[0]) : ""}
            />
            <Field label={t("customer.list.column.agent")} value={detail.owner_name} />
            <Field label={t("customer.list.column.introducer")} value={detail.introducer_name ?? ""} />
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("customer.detail.section.self_assessment")}</h2>
        <Card>
          <CardContent className="flex items-center justify-between pt-6 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">{t("customer.detail.self_assessment_hint")}</p>
              {detail.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {detail.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px]">
                      {t((TQC_TAG_I18N_KEY[tag] ?? tag) as Parameters<typeof t>[0])}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button size="sm" variant="ghost" render={<Link href={`/admin/customers/${customerId}/self-schedule`}>{t("schedule.appointment.nav_link")}</Link>} />
              <Button size="sm" variant="ghost" render={<Link href={`/admin/customers/${customerId}/self-report`}>{t("tqc.report.view_link")}</Link>} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("customer.detail.section.children")}</h2>
        {children.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("customer.child.none")}</p>
        ) : (
          <div className="divide-y rounded-md border">
            {children.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p>{c.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.school || "—"} {c.remark ? `· ${c.remark}` : ""}
                  </p>
                  {c.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-[10px]">
                          {t((TQC_TAG_I18N_KEY[tag] ?? tag) as Parameters<typeof t>[0])}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground tabular-nums">
                    {t("customer.child.age")}: {ageFromDob(c.date_of_birth)}
                  </span>
                  <Button size="sm" variant="ghost" render={<Link href={`/admin/customers/children/${c.id}/schedule`}>{t("schedule.appointment.nav_link")}</Link>} />
                  <Button size="sm" variant="ghost" render={<Link href={`/admin/customers/children/${c.id}/report`}>{t("tqc.report.view_link")}</Link>} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("customer.detail.section.sales_orders")}</h2>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("customer.detail.no_orders")}</p>
        ) : (
          <div className="divide-y rounded-md border">
            {orders.map((o) => (
              <div key={o.order_id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p>{ITEM_TYPE_LABEL[o.item_type] ?? o.item_type}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(o.created_at)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">{formatMYR(o.total_amount)}</span>
                  <Badge variant={o.status === "paid" ? "secondary" : "outline"}>{ORDER_STATUS_LABEL[o.status] ?? o.status}</Badge>
                  {o.status === "paid" && (
                    <Button size="sm" variant="ghost" render={<Link href={`/admin/sales-orders/${o.order_id}/receipt`}>打印收据</Link>} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("customer.detail.section.reports")}</h2>
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {reportEligibleOrders.length === 0
              ? t("customer.detail.no_orders")
              : `${deliveredCount} / ${reportEligibleOrders.length}`}
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("customer.detail.section.commission")}</h2>
        {commissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("customer.detail.no_commission")}</p>
        ) : (
          <div className="divide-y rounded-md border">
            {commissions.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-muted-foreground">{TRIGGER_LABEL[c.trigger_type] ?? c.trigger_type}</span>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">{formatMYR(c.commission_amount)}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(c.calculated_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("customer.detail.section.timeline")}</h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("customer.detail.no_timeline")}</p>
        ) : (
          <div className="divide-y rounded-md border">
            {timeline.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>{t(`customer.timeline.${entry.action}` as Parameters<typeof t>[0])}</span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{entry.actor_name}</span>
                  <span>{new Date(entry.occurred_at).toLocaleString("zh-CN")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
