import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type IntroducerApplicationStatus = "pending" | "approved" | "rejected";

export interface IntroducerApplicationRow {
  id: string;
  status: IntroducerApplicationStatus;
  full_name: string;
  email: string;
  phone: string;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_no: string | null;
  sponsor_referral_code: string | null;
  sponsor_name: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export async function listIntroducerApplications(statusFilter?: IntroducerApplicationStatus): Promise<IntroducerApplicationRow[]> {
  const admin = createAdminClient();

  let query = admin
    .from("introducer_applications")
    .select("id, status, full_name, email, phone, bank_name, bank_account_name, bank_account_no, sponsor_referral_code, sponsor_id, rejection_reason, created_at")
    .order("created_at", { ascending: false });
  if (statusFilter) query = query.eq("status", statusFilter);

  const { data: applications, error } = await query;
  if (error || !applications) return [];

  // introducers <-> individuals have no direct foreign key (both point at
  // parties) — same reasoning as loadIndividualsByPartyIds in registrations/data.ts.
  const sponsorIds = [...new Set(applications.map((a) => a.sponsor_id).filter((id): id is string => !!id))];
  const sponsorNameById = new Map<string, string>();
  if (sponsorIds.length > 0) {
    const { data: sponsors } = await admin.from("introducers").select("id, party_id").in("id", sponsorIds);
    const partyIds = (sponsors ?? []).map((s) => s.party_id);
    const { data: identities } = await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds);
    const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));
    for (const s of sponsors ?? []) {
      const name = nameByParty.get(s.party_id);
      if (name) sponsorNameById.set(s.id, name);
    }
  }

  return applications.map((a) => ({
    id: a.id,
    status: a.status as IntroducerApplicationStatus,
    full_name: a.full_name,
    email: a.email,
    phone: a.phone,
    bank_name: a.bank_name,
    bank_account_name: a.bank_account_name,
    bank_account_no: a.bank_account_no,
    sponsor_referral_code: a.sponsor_referral_code,
    sponsor_name: a.sponsor_id ? (sponsorNameById.get(a.sponsor_id) ?? null) : null,
    rejection_reason: a.rejection_reason,
    created_at: a.created_at,
  }));
}
