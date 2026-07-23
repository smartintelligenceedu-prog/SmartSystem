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
import { EditInfoForm } from "./edit-info-form";
import { ct } from "@/lib/i18n-client";

const STATUS_KEY: Record<AnalystStatus, "dashboard.agent.status.pending" | "dashboard.agent.status.approved" | "dashboard.agent.status.suspended" | "dashboard.agent.status.rejected" | "dashboard.agent.status.terminated"> = {
  pending: "dashboard.agent.status.pending",
  approved: "dashboard.agent.status.approved",
  suspended: "dashboard.agent.status.suspended",
  rejected: "dashboard.agent.status.rejected",
  terminated: "dashboard.agent.status.terminated",
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
          {ct("registrations.detail.view_document")}
        </a>
      ) : (
        <p className="text-sm text-muted-foreground">{ct("registrations.detail.not_uploaded")}</p>
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
            {ct("registrations.detail.submitted_at_prefix")}{new Date(detail.created_at).toLocaleString("zh-CN")}
          </p>
        </div>
        <Badge>{ct(STATUS_KEY[detail.status])}</Badge>
      </div>

      <EditInfoForm detail={detail} />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("registrations.detail.personal_info_heading")}</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label={ct("registrations.detail.field.ic")} value={detail.ic_or_passport_no} />
            <Field label={ct("registrations.detail.field.phone")} value={detail.phone} />
            <Field label={ct("registrations.detail.field.email")} value={detail.email} />
            <Field label={ct("registrations.detail.field.sponsor")} value={detail.sponsor_name ?? ct("registrations.detail.none")} />
          </div>
          <DocumentLink label={ct("registrations.detail.field.ic_photo")} url={detail.ic_document_signed_url} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("registrations.detail.bank_info_heading")}</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label={ct("registrations.detail.field.bank_name")} value={detail.bank_name ?? "—"} />
            <Field label={ct("registrations.detail.field.bank_account_name")} value={detail.bank_account_name ?? "—"} />
            <Field label={ct("registrations.detail.field.bank_account_no")} value={detail.bank_account_no ?? "—"} />
          </div>
        </CardContent>
      </Card>

      {detail.registration_order_id && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("registrations.detail.registration_payment_heading")}</p>
            <Field label={ct("registrations.detail.field.kit")} value={`${detail.kit_name} · ${formatMYR(detail.price)}`} />
            <DocumentLink label={ct("registrations.detail.field.payment_screenshot")} url={detail.payment_screenshot_signed_url} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {ct("registrations.detail.assigned_leader_heading")}
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
                <SelectValue placeholder={ct("registrations.detail.leader_placeholder")} />
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
              {ct("registrations.detail.save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {detail.status === "approved" && <LoginAccountCard detail={detail} />}

      {isAdmin && detail.status === "approved" && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("registrations.certification.section_title")}</p>
            {detail.certification_passed_at ? (
              <p className="text-sm">
                {ct("registrations.certification.passed_label")}{" "}
                {new Date(detail.certification_passed_at).toLocaleString("zh-CN")}
              </p>
            ) : detail.resale_voucher_locked ? (
              <>
                <p className="text-sm text-muted-foreground">{ct("registrations.certification.pending_description")}</p>
                <Button disabled={isPending} onClick={() => run(() => adminApproveCertification(detail.analyst_id))}>
                  {ct("registrations.certification.approve_button")}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{ct("registrations.certification.no_locked_voucher")}</p>
            )}
          </CardContent>
        </Card>
      )}

      {detail.status === "rejected" && detail.rejection_reason && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("registrations.detail.rejection_reason_heading")}</p>
            <p className="mt-1 text-sm">{detail.rejection_reason}</p>
          </CardContent>
        </Card>
      )}

      {message && <p className="text-sm">{message}</p>}

      <div className="flex flex-wrap gap-3">
        {detail.status === "pending" && (
          <>
            <Button disabled={isPending} onClick={() => run(() => adminApproveRegistration(detail.analyst_id))}>
              {ct("registrations.detail.approve")}
            </Button>
            <Button variant="destructive" disabled={isPending} onClick={() => setShowRejectForm((v) => !v)}>
              {ct("registrations.detail.reject")}
            </Button>
          </>
        )}
        {detail.status === "approved" && (
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() => run(() => adminSetSuspendStatus(detail.analyst_id, true))}
          >
            {ct("registrations.detail.suspend")}
          </Button>
        )}
        {detail.status === "suspended" && (
          <Button disabled={isPending} onClick={() => run(() => adminSetSuspendStatus(detail.analyst_id, false))}>
            {ct("registrations.detail.resume")}
          </Button>
        )}
      </div>

      {showRejectForm && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <Label htmlFor="reject-reason">{ct("registrations.detail.rejection_reason_heading")}</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={ct("registrations.detail.reject_reason_placeholder")}
            />
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => run(() => adminRejectRegistration(detail.analyst_id, rejectReason))}
            >
              {ct("registrations.detail.confirm_reject")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
