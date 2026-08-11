"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/i18n-client";
import { addStaffMember, type AddStaffMemberState } from "./actions";

const initialState: AddStaffMemberState = { status: "idle" };

// Deliberately no <form> element here — this renders inside
// CreateStaffPayslipForm's own <form>, and nested <form>s are invalid HTML
// (a browser silently drops the inner tag, so its submit button ends up
// firing the OUTER form instead — that's exactly what silently swallowed
// every "add staff member" attempt before this fix). Controlled input +
// manual FormData + direct dispatch sidesteps the whole nested-form issue.
export function AddStaffMemberForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [state, dispatch] = useActionState(addStaffMember, initialState);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (state.status === "success") {
      setFullName("");
      router.refresh();
    }
  }, [state, router]);

  function handleAdd() {
    const formData = new FormData();
    formData.set("full_name", fullName);
    startTransition(() => {
      dispatch(formData);
    });
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {ct("payroll.staff.add_member_toggle")}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
      <div className="space-y-2">
        <Label htmlFor="add_staff_full_name">{ct("payroll.staff.add_member_name_label")}</Label>
        <Input
          id="add_staff_full_name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder={ct("payroll.staff.add_member_name_placeholder")}
        />
      </div>
      <Button type="button" size="sm" onClick={handleAdd} disabled={isPending || !fullName.trim()}>
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
    </div>
  );
}
