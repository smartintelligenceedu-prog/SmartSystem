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
  created_at: string;
}

export async function listCampaigns(): Promise<CampaignRow[]> {
  const admin = createAdminClient();
  const { data: campaigns } = await admin
    .from("channel_campaigns")
    .select("id, name, campaign_type, location, status, pic_analyst_id, pic_report_override_amount, pic_analyst_report_fee_amount, created_at")
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
    created_at: c.created_at,
  }));
}
