import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS entirely. Only import this from Server
 * Actions / Route Handlers, and only for operations that genuinely need to
 * cross RLS on purpose (e.g. public registration signup, where the visitor
 * has no Supabase Auth session yet to be scoped under). The `server-only`
 * import makes accidentally bundling this into client code a build error.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — copy .env.local.example to .env.local and fill in your Supabase project values."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
