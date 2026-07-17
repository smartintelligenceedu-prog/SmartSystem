import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listCertificationQuestions, getPassingScore } from "../data";
import { CreateQuestionForm } from "./create-question-form";
import { QuestionRow } from "./question-row";
import { PassingScoreForm } from "./passing-score-form";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function CertificationQuestionsPage() {
  const context = await getPortalUserContext();
  if (!isBackOfficeRole(context)) redirect("/admin");

  const [questions, passingScore] = await Promise.all([listCertificationQuestions(), getPassingScore()]);
  const setOne = questions.filter((q) => q.question_set === 1);
  const setTwo = questions.filter((q) => q.question_set === 2);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <Link href="/admin/certification" className="text-xs text-muted-foreground hover:underline">
          {t("certification.admin.back_link")}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{t("certification.admin.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("certification.admin.subtitle")}</p>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("certification.admin.passing_score_title")}</h2>
        <PassingScoreForm currentScore={passingScore} />
      </div>

      {([1, 2] as const).map((set) => (
        <div key={set}>
          <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">
            {t("certification.admin.question_set_label")} {set}
          </h2>
          <div className="divide-y rounded-md border">
            {(set === 1 ? setOne : setTwo).length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">{t("certification.admin.no_questions")}</p>
            )}
            {(set === 1 ? setOne : setTwo).map((q) => (
              <QuestionRow key={q.id} question={q} />
            ))}
          </div>
        </div>
      ))}

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("certification.admin.add_question_title")}</h2>
        <CreateQuestionForm />
      </div>
    </div>
  );
}
