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

const REVIEW_STATUS_LABEL: Record<string, string> = {
  pending: "待审核",
  approved: "已核准",
  rejected: "已拒绝",
};

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
          <h1 className="text-xl font-semibold">销售订单审核</h1>
          <p className="text-sm text-muted-foreground">提交于 {new Date(detail.created_at).toLocaleString("zh-CN")}</p>
        </div>
        <Badge>{REVIEW_STATUS_LABEL[detail.review_status] ?? detail.review_status}</Badge>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6">
          <Field label="提交分析师" value={detail.analyst_name} />
          <Field label="总金额" value={formatMYR(detail.total_amount)} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">顾客明细</p>
          <div className="divide-y rounded-md border">
            {detail.items.map((item) => (
              <div key={item.item_id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <p>{item.customer_name}</p>
                  <p className="text-xs text-muted-foreground">负责分析师：{item.analyst_name}</p>
                </div>
                <span className="tabular-nums">{formatMYR(item.subtotal)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">缴费截图</p>
          {detail.payment_screenshot_signed_url ? (
            <a href={detail.payment_screenshot_signed_url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
              查看档案
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">未上传</p>
          )}
        </CardContent>
      </Card>

      {detail.review_status === "rejected" && detail.rejection_reason && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">拒绝原因</p>
            <p className="mt-1 text-sm">{detail.rejection_reason}</p>
          </CardContent>
        </Card>
      )}

      {message && <p className="text-sm">{message}</p>}

      {detail.review_status === "pending" && (
        <div className="flex flex-wrap gap-3">
          <Button disabled={isPending} onClick={() => run(() => adminApproveSalesOrder(detail.order_id))}>
            核准
          </Button>
          <Button variant="destructive" disabled={isPending} onClick={() => setShowRejectForm((v) => !v)}>
            拒绝
          </Button>
        </div>
      )}

      {showRejectForm && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <Label htmlFor="reject-reason">拒绝原因</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="例如：缴费截图与金额不符"
            />
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => run(() => adminRejectSalesOrder(detail.order_id, rejectReason))}
            >
              确认拒绝
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
