"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/i18n-client";

// A back-dated expense entered today for an earlier month should show up
// when that month is in range, not silently change whatever period happens
// to be open right now — so P&L, the report cost summary, and the ledger
// review below are all keyed off these two query params instead of always
// assuming "this month" (see the identical note this replaced in the old
// single-month month-picker.tsx).
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function monthStr(year: number, monthIndex0: number): string {
  return `${year}-${pad(monthIndex0 + 1)}`;
}

export function DateRangePicker({ from, to }: { from: string; to: string }) {
  const router = useRouter();

  function go(nextFrom: string, nextTo: string) {
    router.push(`/admin/finance?from=${nextFrom}&to=${nextTo}`);
  }

  function setThisMonth() {
    const now = new Date();
    const m = monthStr(now.getFullYear(), now.getMonth());
    go(m, m);
  }

  function setThisQuarter() {
    const now = new Date();
    const quarterStartMonthIndex0 = Math.floor(now.getMonth() / 3) * 3;
    go(monthStr(now.getFullYear(), quarterStartMonthIndex0), monthStr(now.getFullYear(), quarterStartMonthIndex0 + 2));
  }

  function setThisYear() {
    const now = new Date();
    go(monthStr(now.getFullYear(), 0), monthStr(now.getFullYear(), 11));
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{ct("finance.page.range_from_label")}</label>
        <input
          type="month"
          value={from}
          onChange={(e) => {
            if (e.target.value) go(e.target.value, to);
          }}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{ct("finance.page.range_to_label")}</label>
        <input
          type="month"
          value={to}
          onChange={(e) => {
            if (e.target.value) go(from, e.target.value);
          }}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={setThisMonth}>
          {ct("finance.page.range_this_month")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={setThisQuarter}>
          {ct("finance.page.range_this_quarter")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={setThisYear}>
          {ct("finance.page.range_this_year")}
        </Button>
      </div>
    </div>
  );
}
