"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";
import { checkDuplicatePhone } from "./data";

async function requireCallerContext(): Promise<
  { userId: string; analystId: string | null; isBackOffice: boolean } | { error: string }
> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: await t("customer.error.not_signed_in") };

  const { data: userRow } = await supabase.from("users").select("id, party_id").eq("auth_user_id", user.id).single();
  if (!userRow) return { error: await t("customer.error.no_user_row") };

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  const { data: analyst } = await supabase
    .from("analysts")
    .select("id, status")
    .eq("party_id", userRow.party_id)
    .maybeSingle();

  return {
    userId: userRow.id,
    analystId: analyst && analyst.status === "approved" ? analyst.id : null,
    isBackOffice: !!isBackOffice,
  };
}

const childSchema = z.object({
  full_name: z.string().trim().min(1),
  gender: z.enum(["male", "female", "other", "undisclosed"]).optional().or(z.literal("")),
  date_of_birth: z.string().optional().or(z.literal("")),
  school: z.string().trim().optional().or(z.literal("")),
  remark: z.string().trim().optional().or(z.literal("")),
});

// Built per-call (not a module-scope constant) since the error messages are
// locale-aware — a module-scope schema would freeze its t() lookups at
// whatever locale happened to be active the first time this module loaded,
// and never update again for other requests/users.
async function buildCustomerFormSchema() {
  return z.object({
    full_name: z.string().trim().min(2, await t("customer.error.required_name")),
    phone: z.string().trim().min(8, await t("customer.error.required_phone")),
    email: z.string().trim().email(await t("customer.error.invalid_email")).optional().or(z.literal("")),
    gender: z.enum(["male", "female", "other", "undisclosed"]).optional().or(z.literal("")),
    date_of_birth: z.string().optional().or(z.literal("")),
    occupation: z.string().trim().optional().or(z.literal("")),
    marital_status: z.enum(["single", "married", "divorced", "widowed", "other"]).optional().or(z.literal("")),
    acquired_via_introducer_id: z.string().uuid().optional().or(z.literal("")),
    children_json: z.string().optional().or(z.literal("")),
    lead_id: z.string().uuid().optional().or(z.literal("")),
  });
}

async function parseCustomerForm(formData: FormData) {
  const customerFormSchema = await buildCustomerFormSchema();
  return customerFormSchema.safeParse({
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    email: formData.get("email") || undefined,
    gender: formData.get("gender") || undefined,
    date_of_birth: formData.get("date_of_birth") || undefined,
    occupation: formData.get("occupation") || undefined,
    marital_status: formData.get("marital_status") || undefined,
    acquired_via_introducer_id: formData.get("acquired_via_introducer_id") || undefined,
    children_json: formData.get("children_json") || undefined,
    lead_id: formData.get("lead_id") || undefined,
  });
}

function parseChildren(childrenJson: string | undefined) {
  if (!childrenJson) return [];
  try {
    const raw = JSON.parse(childrenJson);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((c) => childSchema.safeParse(c))
      .filter((r): r is { success: true; data: z.infer<typeof childSchema> } => r.success)
      .map((r) => r.data)
      .filter((c) => c.full_name.trim().length > 0);
  } catch {
    return [];
  }
}

async function replaceChildren(admin: ReturnType<typeof createAdminClient>, customerId: string, children: z.infer<typeof childSchema>[]) {
  await admin.from("customer_children").delete().eq("customer_id", customerId);
  if (children.length === 0) return;
  await admin.from("customer_children").insert(
    children.map((c) => ({
      customer_id: customerId,
      full_name: c.full_name,
      gender: c.gender || null,
      date_of_birth: c.date_of_birth || null,
      school: c.school || null,
      remark: c.remark || null,
    }))
  );
}

async function logCustomerActivity(admin: ReturnType<typeof createAdminClient>, actorUserId: string, customerId: string, action: string) {
  await admin.from("audit_logs").insert({
    actor_user_id: actorUserId,
    action,
    entity_type: "customer",
    entity_id: customerId,
    occurred_at: new Date().toISOString(),
  });
}

export type CustomerFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; customerId: string };

export async function createCustomer(_prev: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const auth = await requireCallerContext();
  if ("error" in auth) return { status: "error", message: auth.error };
  if (!auth.analystId) return { status: "error", message: await t("customer.error.no_permission") };

  const parsed = await parseCustomerForm(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("customer.error.invalid_form")) };
  }
  const input = parsed.data;
  const children = parseChildren(input.children_json);

  const dup = await checkDuplicatePhone(input.phone);
  if (dup.duplicatePhone) return { status: "error", message: await t("customer.error.duplicate_phone") };

  const admin = createAdminClient();

  const { data: party, error: partyError } = await admin.from("parties").insert({ party_type: "individual" }).select("id").single();
  if (partyError) return { status: "error", message: `${await t("customer.error.no_permission")}: ${partyError.message}` };

  const { error: individualError } = await admin.from("individuals").insert({
    party_id: party.id,
    full_name: input.full_name,
    phone: input.phone,
    email: input.email || null,
    gender: input.gender || null,
    date_of_birth: input.date_of_birth || null,
  });
  if (individualError) return { status: "error", message: individualError.message };

  const { data: customer, error: customerError } = await admin
    .from("customers")
    .insert({
      party_id: party.id,
      owner_analyst_id: auth.analystId,
      acquired_via_introducer_id: input.acquired_via_introducer_id || null,
      occupation: input.occupation || null,
      marital_status: input.marital_status || null,
      status: "active",
    })
    .select("id")
    .single();
  if (customerError) return { status: "error", message: customerError.message };

  await replaceChildren(admin, customer.id, children);
  await logCustomerActivity(admin, auth.userId, customer.id, "created");

  // Lead-to-customer conversion (see /refer/[code] intake flow): only the
  // lead's own assigned analyst or back office may close it out, and only
  // if it isn't already converted — a stale/reused lead_id in the URL
  // should silently no-op rather than reassign someone else's lead.
  if (input.lead_id) {
    const { data: lead } = await admin.from("leads").select("id, assigned_analyst_id, status").eq("id", input.lead_id).maybeSingle();
    if (lead && lead.status !== "converted" && (auth.isBackOffice || lead.assigned_analyst_id === auth.analystId)) {
      await admin.from("leads").update({ status: "converted", converted_customer_id: customer.id }).eq("id", input.lead_id);
      revalidatePath("/admin/leads");
    }
  }

  revalidatePath("/admin/customers");
  return { status: "success", customerId: customer.id };
}

export async function updateCustomer(customerId: string, _prev: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const auth = await requireCallerContext();
  if ("error" in auth) return { status: "error", message: auth.error };

  const admin = createAdminClient();
  const { data: customer } = await admin.from("customers").select("id, party_id, owner_analyst_id").eq("id", customerId).maybeSingle();
  if (!customer) return { status: "error", message: await t("customer.error.not_found") };
  if (!auth.isBackOffice && customer.owner_analyst_id !== auth.analystId) {
    return { status: "error", message: await t("customer.error.not_owner") };
  }

  const parsed = await parseCustomerForm(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? (await t("customer.error.invalid_form")) };
  }
  const input = parsed.data;
  const children = parseChildren(input.children_json);

  const dup = await checkDuplicatePhone(input.phone, customerId);
  if (dup.duplicatePhone) return { status: "error", message: await t("customer.error.duplicate_phone") };

  const { error: individualError } = await admin
    .from("individuals")
    .update({
      full_name: input.full_name,
      phone: input.phone,
      email: input.email || null,
      gender: input.gender || null,
      date_of_birth: input.date_of_birth || null,
    })
    .eq("party_id", customer.party_id);
  if (individualError) return { status: "error", message: individualError.message };

  const { error: customerError } = await admin
    .from("customers")
    .update({
      acquired_via_introducer_id: input.acquired_via_introducer_id || null,
      occupation: input.occupation || null,
      marital_status: input.marital_status || null,
    })
    .eq("id", customerId);
  if (customerError) return { status: "error", message: customerError.message };

  await replaceChildren(admin, customerId, children);
  await logCustomerActivity(admin, auth.userId, customerId, "updated");

  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${customerId}`);
  return { status: "success", customerId };
}

export async function setCustomerArchived(customerId: string, archived: boolean): Promise<{ ok: boolean; message: string }> {
  const auth = await requireCallerContext();
  if ("error" in auth) return { ok: false, message: auth.error };

  const admin = createAdminClient();
  const { data: customer } = await admin.from("customers").select("id, owner_analyst_id, status").eq("id", customerId).maybeSingle();
  if (!customer) return { ok: false, message: await t("customer.error.not_found") };
  if (!auth.isBackOffice && customer.owner_analyst_id !== auth.analystId) {
    return { ok: false, message: await t("customer.error.not_owner") };
  }

  const { error } = await admin.from("customers").update({ status: archived ? "inactive" : "active" }).eq("id", customerId);
  if (error) return { ok: false, message: error.message };

  await logCustomerActivity(admin, auth.userId, customerId, archived ? "archived" : "restored");

  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${customerId}`);
  return { ok: true, message: "ok" };
}
