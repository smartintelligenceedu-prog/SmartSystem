import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Logo } from "@/components/logo";
import type { AnalystStatus } from "@/lib/types/registration";
import { t, type TranslationKey } from "@/lib/i18n";

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

const STATUS_COPY_KEY: Record<AnalystStatus, { eyebrow: TranslationKey; heading: TranslationKey; body: TranslationKey }> = {
  pending: {
    eyebrow: "register.pending.status.pending.eyebrow",
    heading: "register.pending.status.pending.heading",
    body: "register.pending.status.pending.body",
  },
  approved: {
    eyebrow: "register.pending.status.approved.eyebrow",
    heading: "register.pending.status.approved.heading",
    body: "register.pending.status.approved.body",
  },
  rejected: {
    eyebrow: "register.pending.status.rejected.eyebrow",
    heading: "register.pending.status.rejected.heading",
    body: "register.pending.status.rejected.body",
  },
  suspended: {
    eyebrow: "register.pending.status.suspended.eyebrow",
    heading: "register.pending.status.suspended.heading",
    body: "register.pending.status.suspended.body",
  },
  terminated: {
    eyebrow: "register.pending.status.terminated.eyebrow",
    heading: "register.pending.status.terminated.heading",
    body: "register.pending.status.terminated.body",
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

  const copyKey = STATUS_COPY_KEY[summary.status];
  const [eyebrow, heading, body, totalLabel, reasonPrefix] = await Promise.all([
    t(copyKey.eyebrow),
    t(copyKey.heading),
    t(copyKey.body),
    t("register.pending.total_label"),
    t("register.pending.reason_prefix"),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <Logo className="mb-6" />
      <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{eyebrow}</p>
      <h1 className="mt-1 text-2xl font-semibold">{heading}</h1>

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
            <span>{totalLabel}</span>
            <span className="tabular-nums">{formatMYR(summary.order.total_amount)}</span>
          </div>
        </CardContent>
      </Card>

      <p className="mt-6 text-sm text-muted-foreground">{body}</p>
      {summary.status === "rejected" && summary.rejectionReason && (
        <p className="mt-2 text-sm text-destructive">{reasonPrefix}{summary.rejectionReason}</p>
      )}
    </main>
  );
}
