"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { updatePassingScore, type PassingScoreState } from "../actions";
import { t } from "@/lib/i18n";

const initialState: PassingScoreState = { status: "idle" };

export function PassingScoreForm({ currentScore }: { currentScore: number }) {
  const [state, formAction, isPending] = useActionState(updatePassingScore, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <Input name="passing_score" type="number" min={1} defaultValue={currentScore} className="w-24" required />
      <span className="text-sm text-muted-foreground">{t("certification.admin.passing_score_suffix")}</span>
      <Button size="sm" type="submit" disabled={isPending}>
        {isPending ? t("certification.admin.form.saving") : t("certification.admin.form.save")}
      </Button>
      {state.status === "error" && (
        <p className="text-xs text-destructive" role="alert">
          {state.message}
        </p>
      )}
      {state.status === "success" && <p className="text-xs text-emerald-600">{t("certification.admin.form.save_success")}</p>}
    </form>
  );
}
