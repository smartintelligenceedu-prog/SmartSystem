"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { adminApproveSalesOrder, adminRejectSalesOrder } from "../actions";
import type { SalesOrderDetail } from "../data";
import { ct } from "@/lib/i18n-client";
import type { TranslationKey } from "@/lib/i18n-shared";

const REVIEW_STATUS_KEY = {
  pending: "sales_orders.review.status.pending",
  approved: "sales_orders.review.status.approved",
  rejected: "sales_orders.review.status.rejected",
} satisfies Record<string, TranslationKey>;

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

export function ReviewPanel({ detail }: { detail: SalesOrderDetail }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  const run = (action: () => Promise<{ ok: boolean; message: string }>) => {
    startTransition(async () => {
      const result = await action();
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{ct("sales_orders.review.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {ct("sales_orders.review.submitted_at_prefix")}
            {new Date(detail.created_at).toLocaleString("zh-CN")}
          </p>
        </div>
        <Badge>
          {detail.review_status in REVIEW_STATUS_KEY
            ? ct(REVIEW_STATUS_KEY[detail.review_status as keyof typeof REVIEW_STATUS_KEY])
            : detail.review_status}
        </Badge>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6">
          <Field label={ct("sales_orders.review.submitting_analyst")} value={detail.analyst_name} />
          <Field label={ct("sales_orders.review.total_amount")} value={formatMYR(detail.total_amount)} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("sales_orders.review.customer_details")}</p>
          <div className="divide-y rounded-md border">
            {detail.items.map((item) => (
              <div key={item.item_id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <p>{item.customer_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ct("sales_orders.review.assigned_analyst_prefix")}
                    {item.analyst_name}
                  </p>
                </div>
                <span className="tabular-nums">{formatMYR(item.subtotal)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("sales_orders.review.payment_screenshot")}</p>
          {detail.payment_screenshot_signed_url ? (
            <a href={detail.payment_screenshot_signed_url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
              {ct("sales_orders.review.view_file")}
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">{ct("sales_orders.review.not_uploaded")}</p>
          )}
        </CardContent>
      </Card>

      {detail.review_status === "rejected" && detail.rejection_reason && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("sales_orders.review.rejection_reason")}</p>
            <p className="mt-1 text-sm">{detail.rejection_reason}</p>
          </CardContent>
        </Card>
      )}

      {message && <p className="text-sm">{message}</p>}

      {detail.review_status === "pending" && (
        <div className="flex flex-wrap gap-3">
          <Button disabled={isPending} onClick={() => run(() => adminApproveSalesOrder(detail.order_id))}>
            {ct("sales_orders.review.approve")}
          </Button>
          <Button variant="destructive" disabled={isPending} onClick={() => setShowRejectForm((v) => !v)}>
            {ct("sales_orders.review.reject")}
          </Button>
        </div>
      )}

      {showRejectForm && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <Label htmlFor="reject-reason">{ct("sales_orders.review.rejection_reason")}</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={ct("sales_orders.review.rejection_reason_placeholder")}
            />
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => run(() => adminRejectSalesOrder(detail.order_id, rejectReason))}
            >
              {ct("sales_orders.review.confirm_reject")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
