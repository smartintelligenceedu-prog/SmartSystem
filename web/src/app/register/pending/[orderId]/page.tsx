import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Logo } from "@/components/logo";
import type { AnalystStatus } from "@/lib/types/registration";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

async function getApplicationSummary(orderId: string) {
  const admin = createAdminClient();
  const { data: order, error } = await admin
    .from("orders")
    .select("id, total_amount, order_items(description, subtotal)")
    .eq("id", orderId)
    .eq("order_type", "registration")
    .maybeSingle();

  if (error || !order) return null;

  const { data: registrationOrder } = await admin
    .from("registration_orders")
    .select("id, rejection_reason")
    .eq("order_id", orderId)
    .maybeSingle();

  if (!registrationOrder) return null;

  const { data: analyst } = await admin
    .from("analysts")
    .select("status")
    .eq("registration_order_id", registrationOrder.id)
    .maybeSingle();

  return {
    order,
    status: (analyst?.status ?? "pending") as AnalystStatus,
    rejectionReason: registrationOrder.rejection_reason as string | null,
  };
}

const STATUS_COPY: Record<AnalystStatus, { eyebrow: string; heading: string; body: string }> = {
  pending: {
    eyebrow: "审核中",
    heading: "申请已提交，等待审核",
    body: "后台会核对你上传的身份证与缴费截图，审核通过后即可开始培训课程，请留意电邮通知。",
  },
  approved: {
    eyebrow: "注册完成",
    heading: "欢迎加入 TQC",
    body: "账户已启用，请留意电邮通知以开始培训课程。",
  },
  rejected: {
    eyebrow: "申请未通过",
    heading: "很抱歉，此次申请未获批准",
    body: "如有疑问请联系推荐人或公司后台。",
  },
  suspended: {
    eyebrow: "账户已暂停",
    heading: "此账户目前已被暂停",
    body: "请联系公司后台了解详情。",
  },
  terminated: {
    eyebrow: "账户已终止",
    heading: "此账户已终止",
    body: "请联系公司后台了解详情。",
  },
};

export default async function RegistrationPendingPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const summary = await getApplicationSummary(orderId);
  if (!summary) notFound();

  const copy = STATUS_COPY[summary.status];

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <Logo className="mb-6" />
      <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{copy.eyebrow}</p>
      <h1 className="mt-1 text-2xl font-semibold">{copy.heading}</h1>

      <Card className="mt-6">
        <CardContent className="space-y-3 pt-6">
          {summary.order.order_items?.map((item, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span className="text-muted-foreground">{item.description}</span>
              <span className="tabular-nums">{formatMYR(item.subtotal)}</span>
            </div>
          ))}
          <Separator />
          <div className="flex justify-between font-medium">
            <span>应付总额</span>
            <span className="tabular-nums">{formatMYR(summary.order.total_amount)}</span>
          </div>
        </CardContent>
      </Card>

      <p className="mt-6 text-sm text-muted-foreground">{copy.body}</p>
      {summary.status === "rejected" && summary.rejectionReason && (
        <p className="mt-2 text-sm text-destructive">原因：{summary.rejectionReason}</p>
      )}
    </main>
  );
}
