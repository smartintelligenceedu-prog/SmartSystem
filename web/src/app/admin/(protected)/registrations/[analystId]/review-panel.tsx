"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  adminApproveCertification,
  adminApproveRegistration,
  adminRejectRegistration,
  adminSetAssignedLeader,
  adminSetSuspendStatus,
} from "../actions";
import type { RegistrationDetail } from "../data";
import type { AnalystStatus } from "@/lib/types/registration";
import { LoginAccountCard } from "./login-account-card";
import { t } from "@/lib/i18n";

const STATUS_LABEL: Record<AnalystStatus, string> = {
  pending: "待审核",
  approved: "已核准",
  suspended: "已暂停",
  rejected: "已拒绝",
  terminated: "已终止",
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

function DocumentLink({ label, url }: { label: string; url: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
          查看档案
        </a>
      ) : (
        <p className="text-sm text-muted-foreground">未上传</p>
      )}
    </div>
  );
}

export function ReviewPanel({
  detail,
  leaders,
  isAdmin,
}: {
  detail: RegistrationDetail;
  leaders: { id: string; name: string }[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [assignedLeaderId, setAssignedLeaderId] = useState(detail.assigned_leader_id ?? "");

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
          <h1 className="text-xl font-semibold">
            {detail.full_name} <span className="text-muted-foreground">({detail.nickname})</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            提交于 {new Date(detail.created_at).toLocaleString("zh-CN")}
          </p>
        </div>
        <Badge>{STATUS_LABEL[detail.status]}</Badge>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">个人资料</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="身份证 / 护照号码" value={detail.ic_or_passport_no} />
            <Field label="电话" value={detail.phone} />
            <Field label="电邮" value={detail.email} />
            <Field label="推荐人 (Introducer)" value={detail.sponsor_name ?? "无"} />
          </div>
          <DocumentLink label="身份证照片" url={detail.ic_document_signed_url} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">银行资料</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="银行名称" value={detail.bank_name ?? "—"} />
            <Field label="户口持有人" value={detail.bank_account_name ?? "—"} />
            <Field label="银行户口号码" value={detail.bank_account_no ?? "—"} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">注册与缴费</p>
          <Field label="套装" value={`${detail.kit_name} · ${formatMYR(detail.price)}`} />
          <DocumentLink label="缴费截图" url={detail.payment_screenshot_signed_url} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Assigned Leader（与推荐人相互独立，不影响佣金）
          </p>
          <div className="flex gap-2">
            {/* Base UI's Select.Value shows the raw value unless Root gets an `items`
                map — see the same note in register-form.tsx. */}
            <Select
              items={leaders.map((leader) => ({ value: leader.id, label: leader.name }))}
              value={assignedLeaderId}
              onValueChange={(value) => setAssignedLeaderId(value ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="未指定" />
              </SelectTrigger>
              <SelectContent>
                {leaders.map((leader) => (
                  <SelectItem key={leader.id} value={leader.id}>
                    {leader.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="secondary"
              disabled={isPending}
              onClick={() => run(() => adminSetAssignedLeader(detail.analyst_id, assignedLeaderId || null))}
            >
              储存
            </Button>
          </div>
        </CardContent>
      </Card>

      {detail.status === "approved" && <LoginAccountCard detail={detail} />}

      {isAdmin && detail.status === "approved" && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("registrations.certification.section_title")}</p>
            {detail.certification_passed_at ? (
              <p className="text-sm">
                {t("registrations.certification.passed_label")}{" "}
                {new Date(detail.certification_passed_at).toLocaleString("zh-CN")}
              </p>
            ) : detail.resale_voucher_locked ? (
              <>
                <p className="text-sm text-muted-foreground">{t("registrations.certification.pending_description")}</p>
                <Button disabled={isPending} onClick={() => run(() => adminApproveCertification(detail.analyst_id))}>
                  {t("registrations.certification.approve_button")}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("registrations.certification.no_locked_voucher")}</p>
            )}
          </CardContent>
        </Card>
      )}

      {detail.status === "rejected" && detail.rejection_reason && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">拒绝原因</p>
            <p className="mt-1 text-sm">{detail.rejection_reason}</p>
          </CardContent>
        </Card>
      )}

      {message && <p className="text-sm">{message}</p>}

      <div className="flex flex-wrap gap-3">
        {detail.status === "pending" && (
          <>
            <Button disabled={isPending} onClick={() => run(() => adminApproveRegistration(detail.analyst_id))}>
              核准
            </Button>
            <Button variant="destructive" disabled={isPending} onClick={() => setShowRejectForm((v) => !v)}>
              拒绝
            </Button>
          </>
        )}
        {detail.status === "approved" && (
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() => run(() => adminSetSuspendStatus(detail.analyst_id, true))}
          >
            暂停此分析师
          </Button>
        )}
        {detail.status === "suspended" && (
          <Button disabled={isPending} onClick={() => run(() => adminSetSuspendStatus(detail.analyst_id, false))}>
            恢复此分析师
          </Button>
        )}
      </div>

      {showRejectForm && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <Label htmlFor="reject-reason">拒绝原因</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="例如：缴费截图与套装金额不符"
            />
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => run(() => adminRejectRegistration(detail.analyst_id, rejectReason))}
            >
              确认拒绝
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
