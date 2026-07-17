"use client";

import { useRouter } from "next/navigation";

// A back-dated expense entered today for an earlier month should show up
// when that month is selected, not silently change whatever month happens
// to be open right now — so P&L and the ledger review below are both keyed
// off this one query param instead of always assuming "this month".
export function MonthPicker({ month }: { month: string }) {
  const router = useRouter();

  return (
    <input
      type="month"
      value={month}
      onChange={(e) => {
        if (e.target.value) router.push(`/admin/finance?month=${e.target.value}`);
      }}
      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
    />
  );
}
