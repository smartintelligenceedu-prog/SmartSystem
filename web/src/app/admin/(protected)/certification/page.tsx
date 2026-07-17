import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { getMyCertificationEligibility, getExamQuestions, getPassingScore, listMyCertificationAttempts } from "./data";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExamForm } from "./exam-form";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const REASON_KEY = {
  not_approved: "certification.status.not_approved",
  no_locked_voucher: "certification.status.no_locked_voucher",
  already_certified: "certification.status.already_certified",
  no_questions: "certification.status.no_questions",
} as const;

export default async function CertificationPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!context.analystId) redirect("/admin");

  const [eligibility, attempts] = await Promise.all([
    getMyCertificationEligibility(context.analystId),
    listMyCertificationAttempts(context.analystId),
  ]);

  let exam: Awaited<ReturnType<typeof getExamQuestions>> = null;
  let passingScore = 0;
  if (eligibility.eligible) {
    [exam, passingScore] = await Promise.all([getExamQuestions(), getPassingScore()]);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t("certification.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("certification.subtitle")}</p>
      </div>

      {eligibility.reason === "already_certified" && (
        <Card>
          <CardContent className="flex items-center justify-between pt-6">
            <p className="text-sm">{t(REASON_KEY.already_certified)}</p>
            <Badge variant="secondary">{new Date(eligibility.certifiedAt!).toLocaleDateString("zh-CN")}</Badge>
          </CardContent>
        </Card>
      )}

      {!eligibility.eligible && eligibility.reason && eligibility.reason !== "already_certified" && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t(REASON_KEY[eligibility.reason])}</p>
          </CardContent>
        </Card>
      )}

      {eligibility.eligible && !exam && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t(REASON_KEY.no_questions)}</p>
          </CardContent>
        </Card>
      )}

      {eligibility.eligible && exam && (
        <ExamForm questionSet={exam.questionSet} questions={exam.questions} passingScore={passingScore} />
      )}

      {attempts.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("certification.attempts.title")}</h2>
          <div className="divide-y rounded-md border">
            {attempts.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-muted-foreground">{new Date(a.attempted_at).toLocaleString("zh-CN")}</span>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums">
                    {a.correct_count} / {a.total_questions}
                  </span>
                  <Badge variant={a.passed ? "secondary" : "outline"}>
                    {a.passed ? t("certification.attempts.passed") : t("certification.attempts.failed")}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
