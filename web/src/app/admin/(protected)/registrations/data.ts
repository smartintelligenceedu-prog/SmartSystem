import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSignedDocumentUrl } from "@/lib/storage";
import type { AnalystStatus } from "@/lib/types/registration";
import type { PortalRole } from "@/lib/auth/roles";

export interface RegistrationListRow {
  analyst_id: string;
  status: AnalystStatus;
  created_at: string;
  full_name: string;
  nickname: string | null;
  email: string;
  phone: string;
  sponsor_name: string | null;
  kit_name: string;
  price: number;
}

export interface RegistrationDetail extends RegistrationListRow {
  party_id: string;
  registration_order_id: string;
  order_id: string;
  ic_or_passport_no: string;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_no: string | null;
  sponsor_id: string | null;
  assigned_leader_id: string | null;
  rejection_reason: string | null;
  ic_document_signed_url: string | null;
  payment_screenshot_signed_url: string | null;
  has_login: boolean;
  portal_roles: PortalRole[];
}

// Not an embedded PostgREST select on purpose: analysts <-> individuals have
// no direct foreign key (both point at parties), so this is built from
// several flat queries merged in application code — see the same note in
// register/actions.ts.
async function loadIndividualsByPartyIds(partyIds: string[]) {
  if (partyIds.length === 0) return new Map<string, { full_name: string; nickname: string | null; email: string; phone: string; ic_or_passport_no: string }>();
  const admin = createAdminClient();
  const { data } = await admin
    .from("individuals")
    .select("party_id, full_name, nickname, email, phone, ic_or_passport_no")
    .in("party_id", partyIds);
  return new Map((data ?? []).map((row) => [row.party_id, row]));
}

export async function listRegistrations(statusFilter?: AnalystStatus): Promise<RegistrationListRow[]> {
  const admin = createAdminClient();

  let query = admin
    .from("analysts")
    .select("id, party_id, sponsor_id, registration_order_id, status, created_at")
    .order("created_at", { ascending: false });
  if (statusFilter) query = query.eq("status", statusFilter);

  const { data: analysts, error } = await query;
  if (error || !analysts) return [];

  const partyIds = analysts.map((a) => a.party_id);
  const sponsorIds = analysts.map((a) => a.sponsor_id).filter((id): id is string => !!id);
  const regOrderIds = analysts.map((a) => a.registration_order_id).filter((id): id is string => !!id);

  // sponsor_id is an analyst id, not a party id — resolve sponsor -> party_id
  // first (analysts already on this page + any that fell outside the status
  // filter, e.g. an approved sponsor while viewing the pending tab), THEN
  // fetch individuals keyed by the real party ids. Feeding analyst ids
  // straight into the individuals lookup (the earlier bug) just silently
  // matches nothing, since individuals.party_id never equals an analyst id.
  const sponsorPartyByAnalystId = new Map(
    analysts.filter((a) => sponsorIds.includes(a.id)).map((a) => [a.id, a.party_id])
  );
  const missingSponsorIds = sponsorIds.filter((id) => !sponsorPartyByAnalystId.has(id));
  if (missingSponsorIds.length > 0) {
    const { data: extraSponsors } = await admin.from("analysts").select("id, party_id").in("id", missingSponsorIds);
    for (const s of extraSponsors ?? []) sponsorPartyByAnalystId.set(s.id, s.party_id);
  }
  const sponsorPartyIds = [...sponsorPartyByAnalystId.values()];

  const [individualsByParty, regOrders] = await Promise.all([
    loadIndividualsByPartyIds([...partyIds, ...sponsorPartyIds]),
    admin.from("registration_orders").select("id, kit_id, order_id").in("id", regOrderIds.length > 0 ? regOrderIds : ["00000000-0000-0000-0000-000000000000"]),
  ]);

  const regOrderById = new Map((regOrders.data ?? []).map((r) => [r.id, r]));
  const kitIds = [...new Set((regOrders.data ?? []).map((r) => r.kit_id))];
  const { data: kits } = await admin.from("registration_kits").select("id, name, price").in("id", kitIds.length > 0 ? kitIds : ["00000000-0000-0000-0000-000000000000"]);
  const kitById = new Map((kits ?? []).map((k) => [k.id, k]));

  return analysts.map((a) => {
    const identity = individualsByParty.get(a.party_id);
    const regOrder = a.registration_order_id ? regOrderById.get(a.registration_order_id) : null;
    const kit = regOrder ? kitById.get(regOrder.kit_id) : null;
    const sponsorPartyId = a.sponsor_id ? sponsorPartyByAnalystId.get(a.sponsor_id) : null;
    const sponsorIdentity = sponsorPartyId ? individualsByParty.get(sponsorPartyId) : null;

    return {
      analyst_id: a.id,
      status: a.status as AnalystStatus,
      created_at: a.created_at,
      full_name: identity?.full_name ?? "—",
      nickname: identity?.nickname ?? null,
      email: identity?.email ?? "—",
      phone: identity?.phone ?? "—",
      sponsor_name: sponsorIdentity?.full_name ?? null,
      kit_name: kit?.name ?? "—",
      price: kit?.price ?? 0,
    };
  });
}

export async function getRegistrationDetail(analystId: string): Promise<RegistrationDetail | null> {
  const admin = createAdminClient();
  const { data: analyst } = await admin
    .from("analysts")
    .select("id, party_id, sponsor_id, assigned_leader_id, registration_order_id, status, created_at, bank_name, bank_account_name, bank_account_no")
    .eq("id", analystId)
    .maybeSingle();
  if (!analyst || !analyst.registration_order_id) return null;

  const { data: identity } = await admin
    .from("individuals")
    .select("full_name, nickname, email, phone, ic_or_passport_no")
    .eq("party_id", analyst.party_id)
    .maybeSingle();
  if (!identity) return null;

  const { data: regOrder } = await admin
    .from("registration_orders")
    .select("id, order_id, kit_id, ic_document_url, payment_screenshot_url, rejection_reason")
    .eq("id", analyst.registration_order_id)
    .maybeSingle();
  if (!regOrder) return null;

  const { data: kit } = await admin.from("registration_kits").select("name, price").eq("id", regOrder.kit_id).maybeSingle();

  let sponsorName: string | null = null;
  if (analyst.sponsor_id) {
    const { data: sponsor } = await admin.from("analysts").select("party_id").eq("id", analyst.sponsor_id).maybeSingle();
    if (sponsor) {
      const { data: sponsorIdentity } = await admin.from("individuals").select("full_name").eq("party_id", sponsor.party_id).maybeSingle();
      sponsorName = sponsorIdentity?.full_name ?? null;
    }
  }

  const [icUrl, paymentUrl] = await Promise.all([
    getSignedDocumentUrl("ic-documents", regOrder.ic_document_url),
    getSignedDocumentUrl("payment-screenshots", regOrder.payment_screenshot_url),
  ]);

  const { data: userRow } = await admin.from("users").select("id").eq("party_id", analyst.party_id).maybeSingle();
  let portalRoles: PortalRole[] = [];
  if (userRow) {
    const { data: roleRows } = await admin.from("user_roles").select("roles(name)").eq("user_id", userRow.id);
    portalRoles = (roleRows ?? [])
      .map((r) => (r.roles as unknown as { name: PortalRole } | null)?.name)
      .filter((name): name is PortalRole => !!name);
  }

  return {
    analyst_id: analyst.id,
    party_id: analyst.party_id,
    registration_order_id: regOrder.id,
    order_id: regOrder.order_id,
    status: analyst.status as AnalystStatus,
    created_at: analyst.created_at,
    full_name: identity.full_name,
    nickname: identity.nickname,
    email: identity.email,
    phone: identity.phone,
    ic_or_passport_no: identity.ic_or_passport_no,
    bank_name: analyst.bank_name,
    bank_account_name: analyst.bank_account_name,
    bank_account_no: analyst.bank_account_no,
    sponsor_id: analyst.sponsor_id,
    sponsor_name: sponsorName,
    assigned_leader_id: analyst.assigned_leader_id,
    kit_name: kit?.name ?? "—",
    price: kit?.price ?? 0,
    rejection_reason: regOrder.rejection_reason,
    ic_document_signed_url: icUrl,
    payment_screenshot_signed_url: paymentUrl,
    has_login: !!userRow,
    portal_roles: portalRoles,
  };
}

export async function searchApprovedLeaders(): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  const { data: analysts } = await admin.from("analysts").select("id, party_id").eq("status", "approved");
  if (!analysts || analysts.length === 0) return [];
  const map = await loadIndividualsByPartyIds(analysts.map((a) => a.party_id));
  return analysts.map((a) => ({ id: a.id, name: map.get(a.party_id)?.full_name ?? "—" }));
}
