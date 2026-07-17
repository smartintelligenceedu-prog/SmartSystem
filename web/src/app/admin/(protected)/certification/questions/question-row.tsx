"use client";

import { useState, useTransition, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateCertificationQuestion, toggleCertificationQuestionActive, type QuestionFormState } from "../actions";
import { t } from "@/lib/i18n";
import type { CertificationQuestionRow } from "../data";

const initialState: QuestionFormState = { status: "idle" };

export function QuestionRow({ question }: { question: CertificationQuestionRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const boundUpdate = updateCertificationQuestion.bind(null, question.id);
  const [state, formAction, isSaving] = useActionState(boundUpdate, initialState);

  useEffect(() => {
    if (state.status === "success") {
      setEditing(false);
      router.refresh();
    }
  }, [state, router]);

  if (editing) {
    return (
      <div className="space-y-3 px-4 py-3 text-sm">
        <form action={formAction} className="space-y-3">
          <div className="flex items-center gap-2">
            <Select
              name="question_set"
              items={[{ value: "1", label: "1" }, { value: "2", label: "2" }]}
              defaultValue={String(question.question_set)}
              required
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
              </SelectContent>
            </Select>
            <Input name="question_text" defaultValue={question.question_text} className="flex-1" required />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                name="correct_choice_index"
                value={i}
                defaultChecked={i === question.correct_choice_index}
                required
                className="size-4 shrink-0"
              />
              <Input name={`choice_${i}`} defaultValue={question.choices[i] ?? ""} required />
            </div>
          ))}
          {state.status === "error" && (
            <p className="text-xs text-destructive" role="alert">
              {state.message}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" type="submit" disabled={isSaving}>
              {t("certification.admin.form.save")}
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
              {t("certification.admin.form.cancel")}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <div>
        <p>
          {question.question_text}
          {!question.is_active && (
            <Badge variant="outline" className="ml-2 text-[10px] text-muted-foreground">
              {t("certification.admin.inactive_badge")}
            </Badge>
          )}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("certification.admin.correct_answer_prefix")} {question.choices[question.correct_choice_index]}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          {t("certification.admin.edit_button")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await toggleCertificationQuestionActive(question.id, !question.is_active);
              router.refresh();
            })
          }
        >
          {question.is_active ? t("certification.admin.deactivate_button") : t("certification.admin.activate_button")}
        </Button>
      </div>
    </div>
  );
}
