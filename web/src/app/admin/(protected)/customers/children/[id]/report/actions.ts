"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChildContext } from "./data";
import { BRAIN_ZONES, LEARNING_STYLES, PERSONALITY_TYPE_VALUES } from "./brain-zones";

async function requireCallerContext(): Promise<{ analystId: string | null; isBackOffice: boolean } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "请先登入" };

  const { data: userRow } = await supabase.from("users").select("id, party_id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: "找不到对应的使用者资料" };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  const { data: analyst } = await supabase.from("analysts").select("id").eq("party_id", userRow.party_id).maybeSingle();

  return { analystId: analyst?.id ?? null, isBackOffice: !!isBackOffice };
}

const scoreSchema = z.coerce.number().min(0, "分数必须介于 0-100 之间").max(100, "分数必须介于 0-100 之间");
const learningStyleValues = LEARNING_STYLES.map((s) => s.value) as [string, ...string[]];

const saveReportSchema = z.object({
  child_id: z.string().uuid(),
  left_brain_pct: scoreSchema,
  right_brain_pct: scoreSchema,
  personality_type: z.enum(PERSONALITY_TYPE_VALUES, { message: "请选择性格类型" }),
  tqc_activity_score: z.coerce.number().min(0, "脑活跃度分数不能为负数"),
  tqc_stars: z.coerce.number().int().min(0).max(5, "星级必须介于 0-5 之间"),
  learning_styles: z.array(z.enum(learningStyleValues)),
  analyst_summary: z.string().trim().optional(),
  ...Object.fromEntries(BRAIN_ZONES.map((z) => [z.field, scoreSchema])),
});

export type SaveOnePageReportState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

// Front-line data entry — the CTO brief frames this as "10-second fast
// entry" done by whoever ran the assessment — so the gate here is back
// office OR the child's customer's OWNING analyst, not back-office-only.
// The write still goes through the admin client; RLS stays back-office-only
// as the conservative default, this check is enforced in the app layer,
// same pattern as every other mutation in this codebase.
export async function saveOnePageReport(_prev: SaveOnePageReportState, formData: FormData): Promise<SaveOnePageReportState> {
  const auth = await requireCallerContext();
  if ("error" in auth) return { status: "error", message: auth.error };

  const childId = formData.get("child_id");
  if (typeof childId !== "string" || !childId) return { status: "error", message: "找不到这位儿童的资料" };

  const child = await getChildContext(childId);
  if (!child) return { status: "error", message: "找不到这位儿童的资料" };

  if (!auth.isBackOffice && auth.analystId !== child.owner_analyst_id) {
    return { status: "error", message: "没有权限执行此操作" };
  }

  const learningStyles = formData.getAll("learning_styles");

  const parsed = saveReportSchema.safeParse({
    child_id: childId,
    left_brain_pct: formData.get("left_brain_pct"),
    right_brain_pct: formData.get("right_brain_pct"),
    personality_type: formData.get("personality_type"),
    tqc_activity_score: formData.get("tqc_activity_score"),
    tqc_stars: formData.get("tqc_stars"),
    learning_styles: learningStyles,
    analyst_summary: formData.get("analyst_summary") || undefined,
    ...Object.fromEntries(BRAIN_ZONES.map((z) => [z.field, formData.get(z.field)])),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "表单资料有误" };
  }

  const { child_id, ...rest } = parsed.data;
  const admin = createAdminClient();
  // A new historical row every save (a child can be retested); the
  // tag-derivation trigger only acts on whichever row is currently the
  // most recent for this child.
  const { error } = await admin.from("tqc_one_page_reports").insert({
    child_id,
    created_by_analyst_id: auth.analystId,
    ...rest,
    analyst_summary: rest.analyst_summary || null,
  });
  if (error) return { status: "error", message: `保存报告失败：${error.message}` };

  revalidatePath(`/admin/customers/children/${childId}/report`);
  revalidatePath(`/admin/customers/${child.customer_id}`);
  return { status: "success" };
}
