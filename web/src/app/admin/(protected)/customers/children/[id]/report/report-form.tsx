"use client";

import { useActionState, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ct } from "@/lib/i18n-client";
import { saveOnePageReport, type SaveOnePageReportState } from "./actions";
import {
  BRAIN_ZONES,
  LEARNING_STYLES,
  PERSONALITY_TYPES,
  ZONE_CATEGORIES,
  autoZoneCategory,
  zonePercentage,
  type LearningStyleValue,
  type ZoneCategory,
} from "./brain-zones";

const initialState: SaveOnePageReportState = { status: "idle" };

// Stage 2 ONLY — this form never books a device or picks a time slot; it
// completes an appointment that Stage 1 (the schedule page) already
// created. That appointment's summary is shown read-only for confirmation,
// never as editable fields — see the 2026-07-14 decoupling fix.
export function ReportForm({
  childId,
  customerId,
  appointmentId,
  appointmentSummary,
}: {
  childId: string | null;
  customerId?: string;
  appointmentId: string;
  appointmentSummary: string;
}) {
  const [state, formAction, isPending] = useActionState(saveOnePageReport, initialState);
  const [selectedStyles, setSelectedStyles] = useState<LearningStyleValue[]>([]);
  // Mirrors the (uncontrolled) score inputs purely to compute each zone's
  // live percentage-of-total and the suggested strength/weakness category —
  // the scores themselves still submit via the inputs' own `name` attribute,
  // not from this state. manualCategory only holds zones the analyst has
  // explicitly clicked a category for; anything not in there keeps following
  // the live auto-suggestion as other zones' scores change.
  const [scores, setScores] = useState<Record<string, number>>({});
  const [manualCategory, setManualCategory] = useState<Partial<Record<string, ZoneCategory>>>({});

  function toggleStyle(value: LearningStyleValue) {
    setSelectedStyles((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  const total = Object.values(scores).reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
  function categoryFor(field: string): ZoneCategory {
    return manualCategory[field] ?? autoZoneCategory(zonePercentage(scores[field] ?? 0, total));
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-6">
          {childId ? <input type="hidden" name="child_id" value={childId} /> : <input type="hidden" name="customer_id" value={customerId} />}
          <input type="hidden" name="appointment_id" value={appointmentId} />
          {selectedStyles.map((style) => (
            <input key={style} type="hidden" name="learning_styles" value={style} />
          ))}

          <div className="rounded-md border border-dashed border-neutral-300 p-3 text-sm text-muted-foreground">
            {ct("tqc.form.appointment_label")}: {appointmentSummary}
          </div>

          <div>
            <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("tqc.form.brain_balance_section")}</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="left_brain_pct">{ct("tqc.form.left_brain_label")}</Label>
                <Input id="left_brain_pct" name="left_brain_pct" type="number" step="0.01" min="0" max="100" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="right_brain_pct">{ct("tqc.form.right_brain_label")}</Label>
                <Input id="right_brain_pct" name="right_brain_pct" type="number" step="0.01" min="0" max="100" required />
              </div>
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("tqc.form.zones_section")}</p>
            <p className="mb-3 text-xs text-muted-foreground">{ct("tqc.form.zones_category_hint")}</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              {BRAIN_ZONES.map((zone) => {
                const pct = zonePercentage(scores[zone.field] ?? 0, total);
                const category = categoryFor(zone.field);
                return (
                  <div key={zone.field} className="space-y-2 rounded-md border border-neutral-200 p-2">
                    <Label htmlFor={zone.field}>{ct(zone.nameKey as Parameters<typeof ct>[0])}</Label>
                    <Input
                      id={zone.field}
                      name={zone.field}
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      required
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setScores((prev) => ({ ...prev, [zone.field]: Number.isFinite(value) ? value : 0 }));
                      }}
                    />
                    <p className="text-xs text-muted-foreground tabular-nums">{pct.toFixed(2)}%</p>
                    <div className="space-y-1">
                      {ZONE_CATEGORIES.map((option) => (
                        <label key={option} className="flex items-center gap-1.5 text-xs">
                          <input
                            type="radio"
                            name={`zone_category_${zone.field}`}
                            value={option}
                            checked={category === option}
                            onChange={() => setManualCategory((prev) => ({ ...prev, [zone.field]: option }))}
                            className="size-3"
                          />
                          {ct(`tqc.zone_category.${option}` as Parameters<typeof ct>[0])}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("tqc.form.personality_section")}</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="personality_type">{ct("tqc.form.personality_type_label")}</Label>
                <Select name="personality_type" items={PERSONALITY_TYPES.map((p) => ({ value: p.value, label: ct(p.nameKey as Parameters<typeof ct>[0]) }))}>
                  <SelectTrigger id="personality_type" className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {PERSONALITY_TYPES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {ct(p.nameKey as Parameters<typeof ct>[0])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tqc_activity_score">{ct("tqc.form.activity_score_label")}</Label>
                <Input id="tqc_activity_score" name="tqc_activity_score" type="number" step="0.01" min="0" required />
              </div>
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{ct("tqc.form.learning_styles_section")}</p>
            <div className="flex flex-wrap gap-2">
              {LEARNING_STYLES.map((style) => {
                const active = selectedStyles.includes(style.value);
                return (
                  <Button
                    key={style.value}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    onClick={() => toggleStyle(style.value)}
                  >
                    {ct(style.nameKey as Parameters<typeof ct>[0])}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="analyst_summary">{ct("tqc.form.analyst_summary_label")}</Label>
            <Textarea id="analyst_summary" name="analyst_summary" rows={3} />
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "success" && <p className="text-sm">{ct("tqc.form.success")}</p>}

          <Button type="submit" disabled={isPending}>
            {ct("tqc.form.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
