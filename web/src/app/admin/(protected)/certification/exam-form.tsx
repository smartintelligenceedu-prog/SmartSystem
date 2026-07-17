"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { submitCertificationExam, type ExamResultState } from "./actions";
import { t } from "@/lib/i18n";
import type { ExamQuestion } from "./data";

const initialState: ExamResultState = { status: "idle" };

export function ExamForm({
  questionSet,
  questions,
  passingScore,
}: {
  questionSet: 1 | 2;
  questions: ExamQuestion[];
  passingScore: number;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(submitCertificationExam, initialState);

  if (state.status === "graded") {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {t("certification.exam.score_label")} {state.correctCount} / {state.totalQuestions}
              {" "}
              ({t("certification.exam.passing_score_label")} {state.passingScore})
            </p>
            <Badge variant={state.passed ? "secondary" : "outline"}>
              {state.passed ? t("certification.exam.passed") : t("certification.exam.failed")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {state.passed ? t("certification.exam.passed_description") : t("certification.exam.failed_description")}
          </p>
          {!state.passed && (
            <Button size="sm" onClick={() => router.refresh()}>
              {t("certification.exam.retry_button")}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="question_set" value={questionSet} />
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {t("certification.exam.passing_score_prefix")} {passingScore} / {questions.length} {t("certification.exam.passing_score_suffix")}
        </p>
        {questions.map((q, qIndex) => (
          <Card key={q.id}>
            <CardContent className="space-y-3 pt-6">
              <p className="text-sm font-medium">
                {qIndex + 1}. {q.question_text}
              </p>
              <div className="space-y-2">
                {q.choices.map((choice, choiceIndex) => (
                  <label key={choiceIndex} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name={`q_${q.id}`} value={choiceIndex} required className="size-4" />
                    {choice}
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}

        {state.status === "error" && (
          <p className="text-sm text-destructive" role="alert">
            {state.message}
          </p>
        )}

        <Button type="submit" disabled={isPending}>
          {isPending ? t("certification.exam.submitting") : t("certification.exam.submit_button")}
        </Button>
      </div>
    </form>
  );
}
