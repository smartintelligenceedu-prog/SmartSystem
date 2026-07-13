import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CommissionRuleRow {
  id: string;
  trigger_type: string;
  level_number: number;
  calculation_type: "percentage" | "flat";
  rate_percent: number | null;
  flat_amount: number | null;
  cap_amount: number | null;
  effective_from: string;
}

// The currently-active rule per (trigger_type, level_number) — same
// "as of today" logic get_active_rule() uses in commission_engine.sql, just
// evaluated in application code instead of SQL. There should only ever be
// one active row per trigger+level combo (see updateCommissionRule, which
// closes out the previous one before inserting a new one), but this picks
// the most recent effective_from defensively in case of any historical
// overlap.
export async function listActiveCommissionRules(): Promise<CommissionRuleRow[]> {
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: rules } = await admin
    .from("commission_rules")
    .select("id, trigger_type, level_number, calculation_type, rate_percent, flat_amount, cap_amount, effective_from, effective_to")
    .lte("effective_from", today)
    .or(`effective_to.is.null,effective_to.gte.${today}`)
    .order("effective_from", { ascending: false });

  const seen = new Set<string>();
  const active: CommissionRuleRow[] = [];
  for (const r of rules ?? []) {
    const key = `${r.trigger_type}:${r.level_number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    active.push({
      id: r.id,
      trigger_type: r.trigger_type,
      level_number: r.level_number,
      calculation_type: r.calculation_type as "percentage" | "flat",
      rate_percent: r.rate_percent === null ? null : Number(r.rate_percent),
      flat_amount: r.flat_amount === null ? null : Number(r.flat_amount),
      cap_amount: r.cap_amount === null ? null : Number(r.cap_amount),
      effective_from: r.effective_from,
    });
  }

  const order = ["recruitment:1", "recruitment:2", "recruitment:3", "personal_sale:1", "pic_channel:1", "introducer:1", "voucher_resale:0"];
  active.sort((a, b) => {
    const ai = order.indexOf(`${a.trigger_type}:${a.level_number}`);
    const bi = order.indexOf(`${b.trigger_type}:${b.level_number}`);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return active;
}

export interface CommissionRuleHistoryRow {
  id: string;
  calculation_type: "percentage" | "flat";
  rate_percent: number | null;
  flat_amount: number | null;
  cap_amount: number | null;
  effective_from: string;
  effective_to: string | null;
}

export async function listCommissionRuleHistory(triggerType: string, level: number): Promise<CommissionRuleHistoryRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("commission_rules")
    .select("id, calculation_type, rate_percent, flat_amount, cap_amount, effective_from, effective_to")
    .eq("trigger_type", triggerType)
    .eq("level_number", level)
    .order("effective_from", { ascending: false });

  return (data ?? []).map((r) => ({
    id: r.id,
    calculation_type: r.calculation_type as "percentage" | "flat",
    rate_percent: r.rate_percent === null ? null : Number(r.rate_percent),
    flat_amount: r.flat_amount === null ? null : Number(r.flat_amount),
    cap_amount: r.cap_amount === null ? null : Number(r.cap_amount),
    effective_from: r.effective_from,
    effective_to: r.effective_to,
  }));
}
