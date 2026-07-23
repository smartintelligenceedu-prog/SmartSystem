import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CertificationQuestionRow {
  id: string;
  question_set: 1 | 2;
  question_text: string;
  choices: string[];
  correct_choice_index: number;
  is_active: boolean;
  sort_order: number;
}

// Admin-only view — includes the correct answer, so this must never be sent
// to the analyst-facing exam page (see getExamQuestions() below, which
// selects out correct_choice_index before returning anything to the client).
export async function listCertificationQuestions(): Promise<CertificationQuestionRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("certification_questions")
    .select("id, question_set, question_text, choices, correct_choice_index, is_active, sort_order")
    .order("question_set", { ascending: true })
    .order("sort_order", { ascending: true });
  return (data ?? []) as CertificationQuestionRow[];
}

export async function getPassingScore(): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin.from("certification_settings").select("passing_score").eq("id", true).maybeSingle();
  return data?.passing_score ?? 8;
}

export interface ExamQuestion {
  id: string;
  question_text: string;
  choices: string[];
}

// Randomly picks one of the two active question sets and strips the correct
// answer before returning — grading re-fetches the full row (with the
// answer) server-side in submitCertificationExam, so the answer key is
// never present in anything sent to the browser.
export async function getExamQuestions(): Promise<{ questionSet: 1 | 2; questions: ExamQuestion[] } | null> {
  const admin = createAdminClient();
  const questionSet: 1 | 2 = Math.random() < 0.5 ? 1 : 2;
  const { data } = await admin
    .from("certification_questions")
    .select("id, question_text, choices")
    .eq("question_set", questionSet)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (!data || data.length === 0) return null;
  return { questionSet, questions: data as ExamQuestion[] };
}

export type CertificationIneligibleReason = "not_approved" | "already_certified" | "no_questions";

export interface CertificationEligibility {
  eligible: boolean;
  reason: CertificationIneligibleReason | null;
  certifiedAt: string | null;
}

// Any approved, not-yet-certified analyst can take the exam — not gated on
// already having a locked resale voucher. Analysts backfilled directly by
// back office (no kit purchase, so no voucher was ever issued) still need a
// way to get certified; a voucher created for them later checks
// certification_passed_at at issue time and skips the lock if they're
// already certified (see adminApproveRegistration in registrations/actions.ts).
export async function getMyCertificationEligibility(analystId: string): Promise<CertificationEligibility> {
  const admin = createAdminClient();
  const { data: analyst } = await admin.from("analysts").select("status, certification_passed_at").eq("id", analystId).maybeSingle();
  if (!analyst) return { eligible: false, reason: "not_approved", certifiedAt: null };
  if (analyst.certification_passed_at) return { eligible: false, reason: "already_certified", certifiedAt: analyst.certification_passed_at };
  if (analyst.status !== "approved") return { eligible: false, reason: "not_approved", certifiedAt: null };

  return { eligible: true, reason: null, certifiedAt: null };
}

export interface CertificationAttemptRow {
  id: string;
  question_set: number;
  total_questions: number;
  correct_count: number;
  passed: boolean;
  attempted_at: string;
}

export async function listMyCertificationAttempts(analystId: string): Promise<CertificationAttemptRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("certification_attempts")
    .select("id, question_set, total_questions, correct_count, passed, attempted_at")
    .eq("analyst_id", analystId)
    .order("attempted_at", { ascending: false });
  return data ?? [];
}
