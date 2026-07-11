// TQC Business Management System — settle-commissions Edge Function
//
// Batches all 'approved' commission_records into a payout run: marks them
// 'paid' and returns one summary line per payee (analyst or introducer) so
// the founder can action the actual bank transfers. Back-office only.
//
// Why this lives in an Edge Function and not a trigger: it's a deliberate,
// on-demand batch operation (or called from pg_cron on a schedule), not a
// side effect of a single row change — and it needs the service role key to
// cross every analyst's RLS boundary at once, which should never be handed
// to a trigger running as an ordinary request.
//
// Deploy:   supabase functions deploy settle-commissions
// Invoke:   POST /functions/v1/settle-commissions   (Authorization: Bearer <user JWT>)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

interface PayoutLine {
  payee_type: "analyst" | "introducer";
  payee_id: string;
  record_count: number;
  total_amount: number;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerToken = authHeader.replace("Bearer ", "");
  if (!callerToken) {
    return jsonResponse({ error: "missing Authorization header" }, 401);
  }

  // Check the CALLER's own permissions using their own token (RLS-respecting client).
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: isBackOffice, error: roleError } = await callerClient.rpc("is_back_office");
  if (roleError) {
    return jsonResponse({ error: `role check failed: ${roleError.message}` }, 500);
  }
  if (!isBackOffice) {
    return jsonResponse({ error: "back office role required" }, 403);
  }

  // From here on, use the service role client — settlement has to cross
  // every analyst's RLS boundary at once, which no per-user policy grants.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: approved, error: fetchError } = await admin
    .from("commission_records")
    .select("id, analyst_id, introducer_id, commission_amount")
    .eq("status", "approved");

  if (fetchError) {
    return jsonResponse({ error: `fetch failed: ${fetchError.message}` }, 500);
  }

  if (!approved || approved.length === 0) {
    return jsonResponse({ message: "nothing to settle", payout_lines: [] }, 200);
  }

  // Group by payee for the summary the founder actually needs to action.
  const grouped = new Map<string, PayoutLine>();
  for (const record of approved) {
    const payeeType: "analyst" | "introducer" = record.analyst_id ? "analyst" : "introducer";
    const payeeId = record.analyst_id ?? record.introducer_id;
    const key = `${payeeType}:${payeeId}`;

    const existing = grouped.get(key);
    if (existing) {
      existing.record_count += 1;
      existing.total_amount += Number(record.commission_amount);
    } else {
      grouped.set(key, {
        payee_type: payeeType,
        payee_id: payeeId as string,
        record_count: 1,
        total_amount: Number(record.commission_amount),
      });
    }
  }

  const recordIds = approved.map((r) => r.id);
  const { error: updateError } = await admin
    .from("commission_records")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .in("id", recordIds);

  if (updateError) {
    return jsonResponse({ error: `settlement update failed: ${updateError.message}` }, 500);
  }

  const payoutLines = Array.from(grouped.values()).sort((a, b) => b.total_amount - a.total_amount);

  return jsonResponse({
    message: `settled ${recordIds.length} commission records across ${payoutLines.length} payees`,
    payout_lines: payoutLines,
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
