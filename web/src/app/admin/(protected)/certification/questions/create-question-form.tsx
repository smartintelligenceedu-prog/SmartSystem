"use client";

import { useActionState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createCertificationQuestion, type QuestionFormState } from "../actions";
import { ct } from "@/lib/i18n-client";

const initialState: QuestionFormState = { status: "idle" };

export function CreateQuestionForm() {
  const [state, formAction, isPending] = useActionState(createCertificationQuestion, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <Card>
      <CardContent className="pt-6">
        {/* Uncontrolled Select (defaultValue, not value/onValueChange) inside a
            real <form action> — the only pattern proven not to silently submit
            the wrong value with Base UI's Select, see record-expense-form.tsx. */}
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="question_set">{ct("certification.admin.form.question_set_label")}</Label>
            <Select name="question_set" items={[{ value: "1", label: "1" }, { value: "2", label: "2" }]} defaultValue="1" required>
              <SelectTrigger id="question_set" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="question_text">{ct("certification.admin.form.question_text_label")}</Label>
            <Input id="question_text" name="question_text" required />
          </div>

          <div className="space-y-1">
            <Label>{ct("certification.admin.form.choices_label")}</Label>
            <p className="text-xs text-muted-foreground">{ct("certification.admin.form.choices_hint")}</p>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="radio" name="correct_choice_index" value={i} defaultChecked={i === 0} required className="size-4 shrink-0" />
                <Input name={`choice_${i}`} placeholder={`${ct("certification.admin.form.choice_placeholder_prefix")} ${i + 1}`} required />
              </div>
            ))}
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "success" && <p className="text-sm text-emerald-600">{ct("certification.admin.form.save_success")}</p>}

          <Button type="submit" disabled={isPending}>
            {isPending ? ct("certification.admin.form.saving") : ct("certification.admin.form.add_button")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
