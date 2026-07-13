"use client";

import { useActionState, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/lib/i18n";
import { saveOnePageReport, type SaveOnePageReportState } from "./actions";
import { BRAIN_ZONES, LEARNING_STYLES, PERSONALITY_TYPES, type LearningStyleValue } from "./brain-zones";

const initialState: SaveOnePageReportState = { status: "idle" };

export function ReportForm({ childId }: { childId: string }) {
  const [state, formAction, isPending] = useActionState(saveOnePageReport, initialState);
  const [selectedStyles, setSelectedStyles] = useState<LearningStyleValue[]>([]);

  function toggleStyle(value: LearningStyleValue) {
    setSelectedStyles((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-6">
          <input type="hidden" name="child_id" value={childId} />
          {selectedStyles.map((style) => (
            <input key={style} type="hidden" name="learning_styles" value={style} />
          ))}

          <div>
            <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("tqc.form.brain_balance_section")}</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="left_brain_pct">{t("tqc.form.left_brain_label")}</Label>
                <Input id="left_brain_pct" name="left_brain_pct" type="number" step="0.01" min="0" max="100" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="right_brain_pct">{t("tqc.form.right_brain_label")}</Label>
                <Input id="right_brain_pct" name="right_brain_pct" type="number" step="0.01" min="0" max="100" required />
              </div>
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("tqc.form.zones_section")}</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              {BRAIN_ZONES.map((zone) => (
                <div key={zone.field} className="space-y-2">
                  <Label htmlFor={zone.field}>{t(zone.nameKey as Parameters<typeof t>[0])}</Label>
                  <Input id={zone.field} name={zone.field} type="number" step="0.01" min="0" max="100" required />
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("tqc.form.personality_section")}</p>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="personality_type">{t("tqc.form.personality_type_label")}</Label>
                <Select name="personality_type" items={PERSONALITY_TYPES.map((p) => ({ value: p.value, label: t(p.nameKey as Parameters<typeof t>[0]) }))}>
                  <SelectTrigger id="personality_type" className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {PERSONALITY_TYPES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {t(p.nameKey as Parameters<typeof t>[0])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tqc_activity_score">{t("tqc.form.activity_score_label")}</Label>
                <Input id="tqc_activity_score" name="tqc_activity_score" type="number" step="0.01" min="0" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tqc_stars">{t("tqc.form.stars_label")}</Label>
                <Input id="tqc_stars" name="tqc_stars" type="number" step="1" min="0" max="5" required />
              </div>
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("tqc.form.learning_styles_section")}</p>
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
                    {t(style.nameKey as Parameters<typeof t>[0])}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="analyst_summary">{t("tqc.form.analyst_summary_label")}</Label>
            <Textarea id="analyst_summary" name="analyst_summary" rows={3} />
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "success" && <p className="text-sm">{t("tqc.form.success")}</p>}

          <Button type="submit" disabled={isPending}>
            {t("tqc.form.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
