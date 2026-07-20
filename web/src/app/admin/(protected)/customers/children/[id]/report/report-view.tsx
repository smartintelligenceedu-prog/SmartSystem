import { t } from "@/lib/i18n";
import { BRAIN_ZONES, LEARNING_STYLES, PERSONALITY_TYPES, autoZoneCategory, zonePercentage, type BrainZoneField, type ZoneCategory } from "./brain-zones";
import type { ChildContext, OnePageReport } from "./data";

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-MY", { year: "numeric", month: "long", day: "numeric" });
}

// 相对优势=红, 相对弱势=蓝 ("within average standard"), 开放性潜能=青 — per
// the reference TQC material (2026-07-17), replacing the old score-gradient
// coloring which didn't reflect this categorical scheme at all.
const CATEGORY_CELL_STYLE: Record<ZoneCategory, string> = {
  strength: "bg-red-100 border-red-300",
  weakness: "bg-blue-100 border-blue-300",
  potential: "bg-cyan-100 border-cyan-300",
};
const CATEGORY_TEXT_STYLE: Record<ZoneCategory, string> = {
  strength: "text-red-700",
  weakness: "text-blue-700",
  potential: "text-cyan-700",
};

export function ReportView({ child, report }: { child: ChildContext; report: OnePageReport }) {
  const zoneEntries = BRAIN_ZONES.map((zone) => ({
    ...zone,
    score: report[zone.field as BrainZoneField],
  }));
  const total = zoneEntries.reduce((sum, z) => sum + z.score, 0);
  const categorizedZones = zoneEntries.map((zone) => {
    const pct = zonePercentage(zone.score, total);
    // A zone missing from zone_categories (every report saved before
    // migration 036) falls back to the same auto strength/weakness split
    // the entry form suggests — nobody ever manually flagged it 开放性潜能,
    // so it can't retroactively show as one.
    const category = report.zone_categories[zone.field as BrainZoneField] ?? autoZoneCategory(pct);
    return { ...zone, pct, category };
  });
  const strengths = categorizedZones.filter((z) => z.category === "strength");
  const weaknesses = categorizedZones.filter((z) => z.category === "weakness");
  const potential = categorizedZones.filter((z) => z.category === "potential");

  const personality = PERSONALITY_TYPES.find((p) => p.value === report.personality_type);

  return (
    <div className="rounded-md border border-neutral-300 bg-white p-8 text-black print:border-0 print:p-0">
      {/* Top: child basic info */}
      <div className="flex items-start justify-between border-b-4 border-black pb-4">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">{t("tqc.report.title")}</h1>
          <p className="mt-1 text-sm text-neutral-600">{child.child_name}</p>
        </div>
        <div className="text-right text-sm text-neutral-600">
          <p>
            {t("tqc.report.child_id_label")}: <span className="font-mono">{(child.child_id ?? child.customer_id).slice(0, 8)}</span>
          </p>
          <p>
            {t("tqc.report.dob_label")}: {formatDate(child.date_of_birth)}
          </p>
          <p>
            {t("tqc.report.assessed_at_label")}: {formatDate(report.recorded_at)}
          </p>
        </div>
      </div>

      {/* Middle row: brain balance + zone grid (left) / personality (right) */}
      <div className="mt-6 grid grid-cols-2 gap-6">
        <div>
          <p className="text-xs font-bold tracking-wide text-neutral-500 uppercase">{t("tqc.report.brain_balance_title")}</p>
          <div className="mt-2 flex h-6 w-full overflow-hidden rounded-full border border-neutral-300 text-xs font-semibold">
            <div className="flex items-center justify-center bg-sky-200" style={{ width: `${report.left_brain_pct}%` }}>
              {t("tqc.report.left_label")} {report.left_brain_pct}%
            </div>
            <div className="flex items-center justify-center bg-amber-200" style={{ width: `${report.right_brain_pct}%` }}>
              {t("tqc.report.right_label")} {report.right_brain_pct}%
            </div>
          </div>

          <p className="mt-5 text-xs font-bold tracking-wide text-neutral-500 uppercase">{t("tqc.report.zones_title")}</p>
          <div className="mt-2 grid grid-cols-5 gap-1.5">
            {categorizedZones.map((zone) => (
              <div key={zone.field} className={`rounded border p-1.5 text-center ${CATEGORY_CELL_STYLE[zone.category]}`}>
                <p className="truncate text-[10px] font-medium text-neutral-700">{t(zone.nameKey as Parameters<typeof t>[0])}</p>
                <p className={`text-sm font-bold tabular-nums ${CATEGORY_TEXT_STYLE[zone.category]}`}>
                  {zone.category === "potential" ? "★" : `${zone.pct.toFixed(2)}%`}
                </p>
                <p className="text-[9px] text-neutral-500 tabular-nums">QC: {zone.score}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-3 text-sm">
            <span className="text-neutral-500">{t("tqc.report.activity_score_label")}:</span>
            <span className="font-bold tabular-nums">{report.tqc_activity_score}</span>
          </div>
        </div>

        <div>
          <p className="text-xs font-bold tracking-wide text-neutral-500 uppercase">{t("tqc.report.personality_title")}</p>
          <div className="mt-2 flex flex-col items-center rounded-md border-2 border-neutral-300 p-4 text-center">
            <span className="text-6xl leading-none">{personality?.emoji ?? "❔"}</span>
            <p className="mt-2 text-base font-bold">
              {personality ? t(personality.nameKey as Parameters<typeof t>[0]) : report.personality_type}
            </p>
            <p className="mt-2 text-xs text-neutral-600">
              {personality ? t(personality.descriptionKey as Parameters<typeof t>[0]) : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Bottom row: strengths/weaknesses/potential (left) / learning styles (right) */}
      <div className="mt-6 grid grid-cols-2 gap-6">
        <div className="space-y-3 text-sm">
          <div>
            <p className="text-xs font-bold tracking-wide text-red-700 uppercase">{t("tqc.report.strengths_title")}</p>
            <ul className="mt-1 list-inside list-disc">
              {strengths.length === 0 && <li className="list-none text-neutral-400">—</li>}
              {strengths.map((z) => (
                <li key={z.field}>
                  {t(z.nameKey as Parameters<typeof t>[0])} ({z.pct.toFixed(2)}%)
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold tracking-wide text-blue-700 uppercase">{t("tqc.report.weaknesses_title")}</p>
            <ul className="mt-1 list-inside list-disc">
              {weaknesses.length === 0 && <li className="list-none text-neutral-400">—</li>}
              {weaknesses.map((z) => (
                <li key={z.field}>
                  {t(z.nameKey as Parameters<typeof t>[0])} ({z.pct.toFixed(2)}%)
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold tracking-wide text-cyan-700 uppercase">{t("tqc.report.potential_title")}</p>
            <ul className="mt-1 list-inside list-disc">
              {potential.length === 0 && <li className="list-none text-neutral-400">—</li>}
              {potential.map((z) => (
                <li key={z.field}>{t(z.nameKey as Parameters<typeof t>[0])} ★</li>
              ))}
            </ul>
          </div>
        </div>

        <div>
          <p className="text-xs font-bold tracking-wide text-neutral-500 uppercase">{t("tqc.report.learning_styles_title")}</p>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {LEARNING_STYLES.map((style) => {
              const active = report.learning_styles.includes(style.value);
              return (
                <div
                  key={style.value}
                  className={`flex flex-col items-center rounded-md border p-2 text-center ${
                    active ? "border-primary bg-primary/10" : "border-neutral-200 opacity-40"
                  }`}
                >
                  <span className="text-2xl leading-none">{style.icon}</span>
                  <p className="mt-1 text-[10px] font-medium">{t(style.nameKey as Parameters<typeof t>[0])}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom: analyst summary + disclaimer */}
      <div className="mt-6 border-t-2 border-black pt-4">
        <p className="text-xs font-bold tracking-wide text-neutral-500 uppercase">{t("tqc.report.summary_title")}</p>
        <p className="mt-1 min-h-10 text-sm whitespace-pre-wrap">{report.analyst_summary || "—"}</p>
        <p className="mt-6 text-center text-[10px] text-neutral-400">{t("tqc.report.disclaimer")}</p>
      </div>
    </div>
  );
}
