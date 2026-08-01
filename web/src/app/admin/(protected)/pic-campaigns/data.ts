import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface AnalystOption {
  id: string;
  name: string;
}

export async function listApprovedAnalystOptions(): Promise<AnalystOption[]> {
  const admin = createAdminClient();
  const { data: analysts } = await admin.from("analysts").select("id, party_id").eq("status", "approved");
  if (!analysts || analysts.length === 0) return [];

  const { data: individuals } = await admin
    .from("individuals")
    .select("party_id, full_name")
    .in("party_id", analysts.map((a) => a.party_id));
  const nameByParty = new Map((individuals ?? []).map((i) => [i.party_id, i.full_name]));

  return analysts
    .map((a) => ({ id: a.id, name: nameByParty.get(a.party_id) ?? "—" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface CampaignRow {
  id: string;
  name: string;
  campaign_type: string;
  location: string | null;
  status: string;
  pic_analyst_id: string;
  pic_name: string;
  pic_report_override_amount: number | null;
  pic_analyst_report_fee_amount: number | null;
  institution_party_id: string | null;
  institution_name: string | null;
  free_report_total_cost: number;
  created_at: string;
}

export async function listCampaigns(): Promise<CampaignRow[]> {
  const admin = createAdminClient();
  const { data: campaigns } = await admin
    .from("channel_campaigns")
    .select(
      "id, name, campaign_type, location, status, pic_analyst_id, pic_report_override_amount, pic_analyst_report_fee_amount, institution_party_id, created_at"
    )
    .order("created_at", { ascending: false });
  if (!campaigns || campaigns.length === 0) return [];

  const analystIds = [...new Set(campaigns.map((c) => c.pic_analyst_id))];
  const { data: analysts } = await admin.from("analysts").select("id, party_id").in("id", analystIds);
  const partyByAnalyst = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));
  const { data: individuals } = await admin
    .from("individuals")
    .select("party_id, full_name")
    .in("party_id", [...partyByAnalyst.values()]);
  const nameByParty = new Map((individuals ?? []).map((i) => [i.party_id, i.full_name]));

  const institutionPartyIds = [...new Set(campaigns.filter((c) => c.institution_party_id).map((c) => c.institution_party_id as string))];
  const { data: orgs } =
    institutionPartyIds.length > 0 ? await admin.from("organizations").select("party_id, legal_name").in("party_id", institutionPartyIds) : { data: [] };
  const institutionNameByParty = new Map((orgs ?? []).map((o) => [o.party_id, o.legal_name]));

  // Free-report cost is a small enough table to just sum in app code rather
  // than a group-by RPC — see listFreeReportGrants() below for the detail log.
  const { data: freeReports } = await admin.from("channel_campaign_free_reports").select("campaign_id, cost").in("campaign_id", campaigns.map((c) => c.id));
  const freeReportCostByCampaign = new Map<string, number>();
  for (const r of freeReports ?? []) {
    freeReportCostByCampaign.set(r.campaign_id, (freeReportCostByCampaign.get(r.campaign_id) ?? 0) + Number(r.cost));
  }

  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    campaign_type: c.campaign_type,
    location: c.location,
    status: c.status,
    pic_analyst_id: c.pic_analyst_id,
    pic_name: nameByParty.get(partyByAnalyst.get(c.pic_analyst_id) ?? "") ?? "—",
    pic_report_override_amount: c.pic_report_override_amount === null ? null : Number(c.pic_report_override_amount),
    pic_analyst_report_fee_amount: c.pic_analyst_report_fee_amount === null ? null : Number(c.pic_analyst_report_fee_amount),
    institution_party_id: c.institution_party_id,
    institution_name: c.institution_party_id ? (institutionNameByParty.get(c.institution_party_id) ?? null) : null,
    free_report_total_cost: freeReportCostByCampaign.get(c.id) ?? 0,
    created_at: c.created_at,
  }));
}

export interface FreeReportGrantRow {
  id: string;
  campaign_id: string;
  campaign_name: string;
  recipient_name: string;
  report_tier: string;
  cost: number;
  notes: string | null;
  created_at: string;
}

export async function listFreeReportGrants(): Promise<FreeReportGrantRow[]> {
  const admin = createAdminClient();
  const { data: grants } = await admin
    .from("channel_campaign_free_reports")
    .select("id, campaign_id, recipient_name, report_tier, cost, notes, created_at")
    .order("created_at", { ascending: false });
  if (!grants || grants.length === 0) return [];

  const campaignIds = [...new Set(grants.map((g) => g.campaign_id))];
  const { data: campaigns } = await admin.from("channel_campaigns").select("id, name").in("id", campaignIds);
  const nameByCampaign = new Map((campaigns ?? []).map((c) => [c.id, c.name]));

  return grants.map((g) => ({
    id: g.id,
    campaign_id: g.campaign_id,
    campaign_name: nameByCampaign.get(g.campaign_id) ?? "—",
    recipient_name: g.recipient_name,
    report_tier: g.report_tier,
    cost: Number(g.cost),
    notes: g.notes,
    created_at: g.created_at,
  }));
}
