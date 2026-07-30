"use client";

import { useRouter } from "next/navigation";

export function MonthPicker({ month }: { month: string }) {
  const router = useRouter();

  return (
    <input
      type="month"
      value={month}
      onChange={(e) => {
        if (e.target.value) router.push(`/admin/commission/summary?month=${e.target.value}`);
      }}
      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
    />
  );
}
