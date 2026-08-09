"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ct } from "@/lib/i18n-client";
import { updateStaffPayslip, deleteStaffPayslip, type UpdateStaffPayslipState } from "./actions";
import { submitWithoutReset } from "@/lib/submit-without-reset";
import type { StaffPayslipRow } from "./data";

const initialState: UpdateStaffPayslipState = { status: "idle" };

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-MY", { year: "numeric", month: "long", day: "numeric" });
}

// Editable/deletable row for the back-office "every staff payslip ever
// issued" list — mirrors the edit-toggle-inline + confirm-then-delete
// pattern already used for schedule slots (schedule-slot-item.tsx).
// staff_payslips never posts to the ledger on its own, so both actions are
// plain row mutations, no reversal entry involved.
export function StaffPayslipListRow({ payslip, detailHref }: { payslip: StaffPayslipRow; detailHref: string }) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const boundUpdate = updateStaffPayslip.bind(null, payslip.id);
  const [state, formAction, isSaving] = useActionState(boundUpdate, initialState);

  useEffect(() => {
    if (state.status === "success") {
      setIsEditing(false);
      router.refresh();
    }
  }, [state, router]);

  function doDelete() {
    if (!window.confirm(ct("payroll.staff.confirm_delete"))) return;
    startDeleteTransition(async () => {
      const result = await deleteStaffPayslip(payslip.id);
      setDeleteMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  if (isEditing) {
    return (
      <div className="border-b py-3">
        <form onSubmit={submitWithoutReset(formAction)} className="flex flex-wrap items-end gap-2">
          <p className="w-full text-sm font-medium">{payslip.full_name}</p>
          <div className="space-y-1">
            <Label htmlFor={`period_start_${payslip.id}`}>{ct("payroll.run.period_start_label")}</Label>
            <Input id={`period_start_${payslip.id}`} name="period_start" type="date" defaultValue={payslip.period_start} className="w-36" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`period_end_${payslip.id}`}>{ct("payroll.run.period_end_label")}</Label>
            <Input id={`period_end_${payslip.id}`} name="period_end" type="date" defaultValue={payslip.period_end} className="w-36" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`amount_${payslip.id}`}>{ct("payroll.staff.amount_label")}</Label>
            <Input
              id={`amount_${payslip.id}`}
              name="gross_amount"
              type="number"
              step="0.01"
              min="0"
              defaultValue={payslip.gross_amount}
              className="w-32"
            />
          </div>
          <div className="min-w-40 flex-1 space-y-1">
            <Label htmlFor={`description_${payslip.id}`}>{ct("payroll.staff.description_label")}</Label>
            <Input id={`description_${payslip.id}`} name="description" defaultValue={payslip.description ?? ""} />
          </div>
          <Button type="submit" size="sm" disabled={isSaving}>
            {ct("payroll.staff.save_button")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setIsEditing(false)} disabled={isSaving}>
            {ct("payroll.staff.cancel_button")}
          </Button>
          {state.status === "error" && (
            <p className="w-full text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
        </form>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between py-3 text-sm">
      <div>
        <p className="flex items-center gap-2">
          {payslip.full_name}
          {payslip.document_type === "admin_fee" && <Badge variant="secondary">{ct("payroll.staff.badge.admin_fee")}</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDate(payslip.period_start)} – {formatDate(payslip.period_end)}
        </p>
        {deleteMessage && <p className="text-xs text-muted-foreground">{deleteMessage}</p>}
      </div>
      <div className="flex items-center gap-3">
        <span className="tabular-nums font-medium">{formatMYR(payslip.gross_amount)}</span>
        <Button size="sm" variant="ghost" render={<Link href={detailHref}>{ct("payroll.view_detail_link")}</Link>} />
        <Button size="sm" variant="ghost" onClick={() => setIsEditing(true)}>
          {ct("payroll.staff.edit_button")}
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive" disabled={isDeleting} onClick={doDelete}>
          {ct("payroll.staff.delete_button")}
        </Button>
      </div>
    </div>
  );
}
