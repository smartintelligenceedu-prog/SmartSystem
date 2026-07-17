"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";
import { getMyCertificationEligibility, getPassingScore } from "./data";

async function requireAnalystUserId(): Promise<{ analystId: string } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("certification.error.not_logged_in") };

  const { data: userRow } = await supabase.from("users").select("party_id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: t("certification.error.no_user_row") };

  const { data: analyst } = await supabase.from("analysts").select("id").eq("party_id", userRow.party_id).maybeSingle();
  if (!analyst) return { error: t("certification.error.not_analyst") };

  return { analystId: analyst.id };
}

async function requireBackOfficeUserId(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("certification.error.not_logged_in") };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  if (!isBackOffice) return { error: t("certification.error.no_permission") };

  const { data: userRow } = await supabase.from("users").select("id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: t("certification.error.no_user_row") };

  return { userId: userRow.id };
}

export type ExamResultState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "graded"; passed: boolean; correctCount: number; totalQuestions: number; passingScore: number };

// Re-fetches the answer key server-side (never trusts anything the client
// might claim about which choice was "correct") and re-checks eligibility,
// since the form could in principle be resubmitted after the analyst was
// already certified by another means (e.g. the admin's manual override
// button) in between loading the page and submitting.
export async function submitCertificationExam(_prev: ExamResultState, formData: FormData): Promise<ExamResultState> {
  const auth = await requireAnalystUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const eligibility = await getMyCertificationEligibility(auth.analystId);
  if (!eligibility.eligible) return { status: "error", message: t("certification.error.not_eligible") };

  const questionSet = Number(formData.get("question_set"));
  if (questionSet !== 1 && questionSet !== 2) return { status: "error", message: t("certification.error.invalid_submission") };

  const admin = createAdminClient();
  const { data: questions } = await admin
    .from("certification_questions")
    .select("id, correct_choice_index")
    .eq("question_set", questionSet)
    .eq("is_active", true);
  if (!questions || questions.length === 0) return { status: "error", message: t("certification.error.invalid_submission") };

  const answers = questions.map((q) => {
    const raw = formData.get(`q_${q.id}`);
    const selectedIndex = raw === null ? null : Number(raw);
    const correct = selectedIndex === q.correct_choice_index;
    return { question_id: q.id, selected_index: selectedIndex, correct };
  });
  const correctCount = answers.filter((a) => a.correct).length;
  const passingScore = await getPassingScore();
  const passed = correctCount >= passingScore;

  const { error: attemptError } = await admin.from("certification_attempts").insert({
    analyst_id: auth.analystId,
    question_set: questionSet,
    total_questions: questions.length,
    correct_count: correctCount,
    passed,
    answers,
  });
  if (attemptError) return { status: "error", message: `${t("certification.error.save_failed")}${attemptError.message}` };

  if (passed) {
    // Same column the manual adminApproveCertification() button sets — fires
    // trg_unlock_resale_voucher_on_certification (migration 021) either way.
    const { error: certifyError } = await admin
      .from("analysts")
      .update({ certification_passed_at: new Date().toISOString() })
      .eq("id", auth.analystId)
      .is("certification_passed_at", null);
    if (certifyError) return { status: "error", message: `${t("certification.error.save_failed")}${certifyError.message}` };
  }

  revalidatePath("/admin/certification");
  return { status: "graded", passed, correctCount, totalQuestions: questions.length, passingScore };
}

const questionSchema = z.object({
  question_set: z.coerce.number().int().min(1).max(2),
  question_text: z.string().trim().min(1, t("certification.admin.error.question_required")),
  choice_0: z.string().trim().min(1, t("certification.admin.error.choice_required")),
  choice_1: z.string().trim().min(1, t("certification.admin.error.choice_required")),
  choice_2: z.string().trim().min(1, t("certification.admin.error.choice_required")),
  choice_3: z.string().trim().min(1, t("certification.admin.error.choice_required")),
  correct_choice_index: z.coerce.number().int().min(0).max(3),
});

export type QuestionFormState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

export async function createCertificationQuestion(_prev: QuestionFormState, formData: FormData): Promise<QuestionFormState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const parsed = questionSchema.safeParse({
    question_set: formData.get("question_set"),
    question_text: formData.get("question_text"),
    choice_0: formData.get("choice_0"),
    choice_1: formData.get("choice_1"),
    choice_2: formData.get("choice_2"),
    choice_3: formData.get("choice_3"),
    correct_choice_index: formData.get("correct_choice_index"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? t("certification.admin.error.invalid_form") };
  const input = parsed.data;

  const admin = createAdminClient();
  const { error } = await admin.from("certification_questions").insert({
    question_set: input.question_set,
    question_text: input.question_text,
    choices: [input.choice_0, input.choice_1, input.choice_2, input.choice_3],
    correct_choice_index: input.correct_choice_index,
  });
  if (error) return { status: "error", message: `${t("certification.admin.error.save_failed")}${error.message}` };

  revalidatePath("/admin/certification/questions");
  return { status: "success" };
}

export async function updateCertificationQuestion(questionId: string, _prev: QuestionFormState, formData: FormData): Promise<QuestionFormState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const parsed = questionSchema.safeParse({
    question_set: formData.get("question_set"),
    question_text: formData.get("question_text"),
    choice_0: formData.get("choice_0"),
    choice_1: formData.get("choice_1"),
    choice_2: formData.get("choice_2"),
    choice_3: formData.get("choice_3"),
    correct_choice_index: formData.get("correct_choice_index"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? t("certification.admin.error.invalid_form") };
  const input = parsed.data;

  const admin = createAdminClient();
  const { error } = await admin
    .from("certification_questions")
    .update({
      question_set: input.question_set,
      question_text: input.question_text,
      choices: [input.choice_0, input.choice_1, input.choice_2, input.choice_3],
      correct_choice_index: input.correct_choice_index,
    })
    .eq("id", questionId);
  if (error) return { status: "error", message: `${t("certification.admin.error.save_failed")}${error.message}` };

  revalidatePath("/admin/certification/questions");
  return { status: "success" };
}

export async function toggleCertificationQuestionActive(questionId: string, isActive: boolean): Promise<{ ok: boolean; message: string }> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { error } = await admin.from("certification_questions").update({ is_active: isActive }).eq("id", questionId);
  if (error) return { ok: false, message: `${t("certification.admin.error.save_failed")}${error.message}` };

  revalidatePath("/admin/certification/questions");
  return { ok: true, message: t("certification.admin.toggle_success") };
}

const passingScoreSchema = z.object({
  passing_score: z.coerce.number().int().min(1, t("certification.admin.error.invalid_passing_score")),
});

export type PassingScoreState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

export async function updatePassingScore(_prev: PassingScoreState, formData: FormData): Promise<PassingScoreState> {
  const auth = await requireBackOfficeUserId();
  if ("error" in auth) return { status: "error", message: auth.error };

  const parsed = passingScoreSchema.safeParse({ passing_score: formData.get("passing_score") });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? t("certification.admin.error.invalid_form") };

  const admin = createAdminClient();
  const { error } = await admin
    .from("certification_settings")
    .update({ passing_score: parsed.data.passing_score, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) return { status: "error", message: `${t("certification.admin.error.save_failed")}${error.message}` };

  revalidatePath("/admin/certification/questions");
  return { status: "success" };
}
