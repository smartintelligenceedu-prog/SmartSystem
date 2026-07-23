import "server-only";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";

const resend = new Resend(process.env.RESEND_API_KEY);
// Resend's shared sandbox sender — works immediately, no domain setup, but
// only reaches addresses verified in the Resend dashboard. Switch to a
// verified company domain (RESEND_FROM_EMAIL) once one is set up.
const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
// Silent monitoring copy on every notification email this system sends
// (back-office alerts, new-analyst initial passwords) — bcc so it never
// shows up in any recipient's headers.
const BCC_ADDRESS = process.env.NOTIFICATIONS_BCC_EMAIL;

// Back office = admin/finance/back_office roles — same set as is_back_office()
// in rls_policies.sql, kept in sync by hand since RLS functions can't be
// called from application code outside a user's own session.
export async function getBackOfficeEmails(): Promise<string[]> {
  const admin = createAdminClient();
  const { data: roles } = await admin.from("roles").select("id").in("name", ["admin", "finance", "back_office"]);
  const roleIds = (roles ?? []).map((r) => r.id);
  if (roleIds.length === 0) return [];

  const { data: userRoles } = await admin.from("user_roles").select("user_id").in("role_id", roleIds);
  const userIds = [...new Set((userRoles ?? []).map((ur) => ur.user_id))];
  if (userIds.length === 0) return [];

  const { data: users } = await admin.from("users").select("party_id").in("id", userIds).eq("status", "active");
  const partyIds = [...new Set((users ?? []).map((u) => u.party_id))];
  if (partyIds.length === 0) return [];

  const { data: identities } = await admin.from("individuals").select("email").in("party_id", partyIds);
  return [...new Set((identities ?? []).map((i) => i.email).filter((e): e is string => !!e))];
}

// Best-effort only — a Resend outage, missing API key, or sandbox recipient
// restriction must never break whatever action triggered this (a sales
// order, a registration, a new login). Errors are logged, never thrown.
//
// BCC_ADDRESS rides along silently on every send when there's already a real
// recipient; if there's no real recipient at all (e.g. no back-office user
// has an email on file), it becomes the primary "to" instead of the
// notification being silently dropped.
export async function sendEmail({ to, subject, html }: { to: string[]; subject: string; html: string }): Promise<void> {
  try {
    const recipients = to.length > 0 ? to : BCC_ADDRESS ? [BCC_ADDRESS] : [];
    if (recipients.length === 0) return;
    const bcc = to.length > 0 && BCC_ADDRESS ? [BCC_ADDRESS] : undefined;
    // resend.emails.send() does NOT throw for API-level errors (e.g. an
    // unverified sending domain) — it resolves normally with `{ data: null,
    // error }`. Only checking for a thrown exception silently treats a
    // rejected send as success, so this must be checked explicitly.
    const { error } = await resend.emails.send({ from: FROM_ADDRESS, to: recipients, subject, html, ...(bcc ? { bcc } : {}) });
    if (error) console.error("sendEmail rejected by Resend:", error);
  } catch (err) {
    console.error("sendEmail failed:", err);
  }
}

export async function notifyBackOffice(subject: string, html: string): Promise<void> {
  const to = await getBackOfficeEmails();
  await sendEmail({ to, subject, html });
}
