"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ct } from "@/lib/i18n-client";
import { fetchInstitutionalOrderForEdit, updateInstitutionalOrder, type EditInstitutionalOrderState } from "./actions";
import { submitWithoutReset } from "@/lib/submit-without-reset";

interface StudentRow {
  name: string;
  analystId: string;
}

const initialState: EditInstitutionalOrderState = { status: "idle" };

// Mirrors CreateInstitutionalOrderForm's item_name/unit_price/student-rows
// shape (migration 047) — institution and package are deliberately not
// editable here (see updateInstitutionalOrder's header comment); a wrong
// institution/package means deleting and recreating the order instead.
export function EditInstitutionalOrderForm({
  orderId,
  agents,
  onCancel,
  onSuccess,
}: {
  orderId: string;
  agents: { id: string; name: string }[];
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [itemName, setItemName] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [packageName, setPackageName] = useState<string | null>(null);
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [isFetchPending, startFetchTransition] = useTransition();
  const [bulkQuantity, setBulkQuantity] = useState("");
  const [bulkAnalystId, setBulkAnalystId] = useState("");

  const boundUpdate = updateInstitutionalOrder.bind(null, orderId);
  const [state, formAction, isPending] = useActionState(boundUpdate, initialState);

  useEffect(() => {
    startFetchTransition(async () => {
      const data = await fetchInstitutionalOrderForEdit(orderId);
      if (data) {
        setItemName(data.item_name);
        setUnitPrice(String(data.unit_price));
        setPackageName(data.package_name);
        setRows(data.rows.map((r) => ({ name: r.name, analystId: r.analyst_id ?? "" })));
      }
      setLoading(false);
    });
  }, [orderId]);

  useEffect(() => {
    if (state.status === "success") onSuccess();
  }, [state, onSuccess]);

  if (loading || isFetchPending) {
    return <p className="text-xs text-muted-foreground">…</p>;
  }

  return (
    <form onSubmit={submitWithoutReset(formAction)} className="flex flex-col items-end gap-2">
      {packageName && (
        <p className="text-xs text-muted-foreground">
          {ct("finance.institutional.edit_order.package_readonly_prefix")}
          {packageName}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-1">
        <Input
          name="item_name"
          className="w-40"
          value={itemName}
          onChange={(e) => setItemName(e.target.value)}
          placeholder={ct("finance.institutional.new_order.item_name_label")}
        />
        <Input
          name="unit_price"
          type="number"
          step="0.01"
          min="0.01"
          className="w-28"
          value={unitPrice}
          onChange={(e) => setUnitPrice(e.target.value)}
          placeholder={ct("finance.institutional.new_order.unit_price_label")}
        />
      </div>
      <div className="flex flex-wrap items-end gap-1 rounded-md border border-dashed p-2">
        <Input
          type="number"
          min="1"
          step="1"
          className="h-8 w-20"
          placeholder={ct("finance.institutional.new_order.bulk_quantity_label")}
          value={bulkQuantity}
          onChange={(e) => setBulkQuantity(e.target.value)}
          disabled={isPending}
        />
        <Select
          items={agents.map((a) => ({ value: a.id, label: a.name }))}
          value={bulkAnalystId || undefined}
          onValueChange={(v) => setBulkAnalystId((v as string) ?? "")}
        >
          <SelectTrigger className="h-8 w-40">
            <SelectValue placeholder={ct("finance.institutional.new_order.bulk_analyst_label")} />
          </SelectTrigger>
          <SelectContent>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isPending || !bulkQuantity || Number(bulkQuantity) < 1}
          onClick={() => setRows(Array.from({ length: Math.floor(Number(bulkQuantity)) }, () => ({ name: "", analystId: bulkAnalystId })))}
        >
          {ct("finance.institutional.new_order.bulk_fill_button")}
        </Button>
      </div>
      <div className="flex w-full flex-col items-end gap-1">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-1">
            <Input
              name="student_name"
              className="w-32"
              value={row.name}
              onChange={(e) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, name: e.target.value } : r)))}
              placeholder={ct("finance.institutional.new_order.student_name_placeholder")}
            />
            <Select
              items={agents.map((a) => ({ value: a.id, label: a.name }))}
              value={row.analystId || undefined}
              onValueChange={(v) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, analystId: (v as string) ?? "" } : r)))}
            >
              <SelectTrigger className="w-40 shrink-0">
                <SelectValue placeholder={ct("finance.institutional.new_order.student_analyst_placeholder")} />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="student_analyst_id" value={row.analystId} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
              disabled={isPending || rows.length <= 1}
            >
              {ct("finance.institutional.new_order.remove_student_button")}
            </Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => setRows((prev) => [...prev, { name: "", analystId: prev[prev.length - 1]?.analystId ?? "" }])} disabled={isPending}>
          {ct("finance.institutional.new_order.add_student_button")}
        </Button>
      </div>
      <div className="flex items-center gap-1">
        <Button type="submit" size="sm" disabled={isPending}>
          {ct("finance.institutional.edit_order.submit")}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={onCancel}>
          {ct("finance.institutional.edit_order.cancel")}
        </Button>
      </div>
      {state.status === "error" && (
        <p className="text-xs text-destructive" role="alert">
          {state.message}
        </p>
      )}
      {state.status === "success" && <p className="text-xs text-muted-foreground">{ct("finance.institutional.edit_order.success")}</p>}
    </form>
  );
}
