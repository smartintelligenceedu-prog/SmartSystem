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
import { t, type TranslationKey } from "@/lib/i18n";
import { buildTagLabelMap } from "@/lib/tqc-tags";
import { BackButton } from "../../_components/back-button";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("zh-CN") : "—";
}

function ageFromDob(dob: string | null, unknownLabel: string): string {
  if (!dob) return unknownLabel;
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age--;
  return String(age);
}

const ITEM_TYPE_KEY = {
  detection_session: "reports.item_type.detection_session",
  voucher_redemption: "reports.item_type.voucher_redemption",
} satisfies Record<string, TranslationKey>;
const ORDER_STATUS_KEY = {
  pending: "order.status.pending",
  paid: "order.status.paid",
  cancelled: "order.status.cancelled",
  refunded: "order.status.refunded",
} satisfies Record<string, TranslationKey>;
const TRIGGER_KEY = {
  personal_sale: "payroll.trigger_type.personal_sale",
  pic_channel: "payroll.trigger_type.pic_channel",
  introducer: "payroll.trigger_type.introducer",
  recruitment: "payroll.trigger_type.recruitment",
  voucher_resale: "payroll.trigger_type.voucher_resale",
  report_override: "payroll.trigger_type.report_override",
  analyst_report_fee: "payroll.trigger_type.analyst_report_fee",
} satisfies Record<string, TranslationKey>;

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

  // t() is async (locale-aware) and can't be called inside a plain .map()
  // callback — every label a .map() below needs gets resolved up front here.
  const tagLabelByTag = await buildTagLabelMap([...detail.tags, ...children.flatMap((c) => c.tags)]);
  const unknownAgeLabel = await t("customer.child.age_unknown");
  const childAgeLabel = await t("customer.child.age");
  const scheduleNavLabel = await t("schedule.appointment.nav_link");
  const reportViewLabel = await t("tqc.report.view_link");
  const printReceiptLabel = await t("customer.detail.print_receipt");
  const itemTypeLabelByType = Object.fromEntries(
    await Promise.all(Object.entries(ITEM_TYPE_KEY).map(async ([k, key]) => [k, await t(key)]))
  ) as Record<string, string>;
  const orderStatusLabelByStatus = Object.fromEntries(
    await Promise.all(Object.entries(ORDER_STATUS_KEY).map(async ([k, key]) => [k, await t(key)]))
  ) as Record<string, string>;
  const triggerLabelByType = Object.fromEntries(
    await Promise.all(Object.entries(TRIGGER_KEY).map(async ([k, key]) => [k, await t(key)]))
  ) as Record<string, string>;
  const distinctTimelineActions = [...new Set(timeline.map((entry) => entry.action))];
  const timelineActionLabels = await Promise.all(
    distinctTimelineActions.map((action) => t(`customer.timeline.${action}` as Parameters<typeof t>[0]))
  );
  const timelineLabelByAction = Object.fromEntries(distinctTimelineActions.map((action, i) => [action, timelineActionLabels[i]]));

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <BackButton />
          <h1 className="mt-1 text-xl font-semibold">{detail.full_name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={detail.status === "active" ? "secondary" : "outline"}>
            {detail.status === "active" ? await t("customer.status.active") : await t("customer.status.inactive")}
          </Badge>
          {canEdit && <Button size="sm" render={<Link href={`/admin/customers/${customerId}/edit`}>{await t("customer.detail.edit_button")}</Link>} />}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("customer.detail.section.profile")}</h2>
        <Card>
          <CardContent className="grid grid-cols-2 gap-4 pt-6 md:grid-cols-3">
            <Field label={await t("customer.field.phone")} value={detail.phone ?? ""} />
            <Field label={await t("customer.field.email")} value={detail.email ?? ""} />
            <Field
              label={await t("customer.field.gender")}
              value={detail.gender ? await t(`customer.field.gender.${detail.gender}` as Parameters<typeof t>[0]) : ""}
            />
            <Field label={await t("customer.field.date_of_birth")} value={formatDate(detail.date_of_birth)} />
            <Field label={await t("customer.field.occupation")} value={detail.occupation ?? ""} />
            <Field
              label={await t("customer.field.marital_status")}
              value={detail.marital_status ? await t(`customer.field.marital_status.${detail.marital_status}` as Parameters<typeof t>[0]) : ""}
            />
            <Field label={await t("customer.list.column.agent")} value={detail.owner_name} />
            <Field label={await t("customer.list.column.introducer")} value={detail.introducer_name ?? ""} />
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("customer.detail.section.self_assessment")}</h2>
        <Card>
          <CardContent className="flex items-center justify-between pt-6 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">{await t("customer.detail.self_assessment_hint")}</p>
              {detail.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {detail.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px]">
                      {tagLabelByTag[tag] ?? tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button size="sm" variant="ghost" render={<Link href={`/admin/customers/${customerId}/self-schedule`}>{scheduleNavLabel}</Link>} />
              <Button size="sm" variant="ghost" render={<Link href={`/admin/customers/${customerId}/self-report`}>{reportViewLabel}</Link>} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("customer.detail.section.children")}</h2>
        {children.length === 0 ? (
          <p className="text-sm text-muted-foreground">{await t("customer.child.none")}</p>
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
                          {tagLabelByTag[tag] ?? tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground tabular-nums">
                    {childAgeLabel}: {ageFromDob(c.date_of_birth, unknownAgeLabel)}
                  </span>
                  <Button size="sm" variant="ghost" render={<Link href={`/admin/customers/children/${c.id}/schedule`}>{scheduleNavLabel}</Link>} />
                  <Button size="sm" variant="ghost" render={<Link href={`/admin/customers/children/${c.id}/report`}>{reportViewLabel}</Link>} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("customer.detail.section.sales_orders")}</h2>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">{await t("customer.detail.no_orders")}</p>
        ) : (
          <div className="divide-y rounded-md border">
            {orders.map((o) => (
              <div key={o.order_id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p>{itemTypeLabelByType[o.item_type] ?? o.item_type}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(o.created_at)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">{formatMYR(o.total_amount)}</span>
                  <Badge variant={o.status === "paid" ? "secondary" : "outline"}>{orderStatusLabelByStatus[o.status] ?? o.status}</Badge>
                  {o.status === "paid" && (
                    <Button size="sm" variant="ghost" render={<Link href={`/admin/sales-orders/${o.order_id}/receipt`}>{printReceiptLabel}</Link>} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("customer.detail.section.reports")}</h2>
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {reportEligibleOrders.length === 0
              ? await t("customer.detail.no_orders")
              : `${deliveredCount} / ${reportEligibleOrders.length}`}
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("customer.detail.section.commission")}</h2>
        {commissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{await t("customer.detail.no_commission")}</p>
        ) : (
          <div className="divide-y rounded-md border">
            {commissions.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-muted-foreground">{triggerLabelByType[c.trigger_type] ?? c.trigger_type}</span>
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
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("customer.detail.section.timeline")}</h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">{await t("customer.detail.no_timeline")}</p>
        ) : (
          <div className="divide-y rounded-md border">
            {timeline.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>{timelineLabelByAction[entry.action]}</span>
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
