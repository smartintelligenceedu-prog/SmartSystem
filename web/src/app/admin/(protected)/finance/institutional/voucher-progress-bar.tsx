import { t } from "@/lib/i18n";

// Remaining-credit warning threshold — CTO spec: <10% remaining flips the
// bar to a warning color so back office notices a bulk deal is running out.
const WARNING_REMAINING_RATIO = 0.1;

export function VoucherProgressBar({ total, used }: { total: number; used: number }) {
  if (total === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const remainingRatio = (total - used) / total;
  const usedPct = Math.min(100, Math.round((used / total) * 100));
  const barColor = remainingRatio <= 0 ? "bg-red-600" : remainingRatio < WARNING_REMAINING_RATIO ? "bg-amber-500" : "bg-emerald-600";

  return (
    <div className="w-32">
      <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
        <span>{t("finance.institutional.voucher.used_label")}</span>
        <span>
          {used}/{total}
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${usedPct}%` }} />
      </div>
    </div>
  );
}
