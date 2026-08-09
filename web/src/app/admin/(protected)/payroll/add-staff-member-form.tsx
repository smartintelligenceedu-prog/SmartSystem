"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/i18n-client";
import { addStaffMember, type AddStaffMemberState } from "./actions";
import { submitWithoutReset } from "@/lib/submit-without-reset";

const initialState: AddStaffMemberState = { status: "idle" };

// Collapsed by default — most payslip creation just picks an existing
// recipient; this only needs to surface when someone genuinely new (with no
// portal login) has to be paid for the first time (migration 072).
export function AddStaffMemberForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(addStaffMember, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {ct("payroll.staff.add_member_toggle")}
      </Button>
    );
  }

  return (
    <form ref={formRef} onSubmit={submitWithoutReset(formAction)} className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
      <div className="space-y-2">
        <Label htmlFor="add_staff_full_name">{ct("payroll.staff.add_member_name_label")}</Label>
        <Input id="add_staff_full_name" name="full_name" placeholder={ct("payroll.staff.add_member_name_placeholder")} required />
      </div>
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? ct("payroll.staff.add_member_submitting") : ct("payroll.staff.add_member_submit")}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
        {ct("payroll.staff.cancel_button")}
      </Button>
      {state.status === "error" && (
        <p className="w-full text-sm text-destructive" role="alert">
          {state.message}
        </p>
      )}
      {state.status === "success" && <p className="w-full text-sm">{ct("payroll.staff.add_member_success")}</p>}
    </form>
  );
}
