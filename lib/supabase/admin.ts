import "server-only";

import { createClient } from "@supabase/supabase-js";

// Service-role Supabase client. Bypasses RLS — use sparingly and only for:
//   * Tasks that need to read/write across tenants by design (e.g. accepting
//     an invite token where the caller isn't yet a member of the target org).
//   * The seed script.
// Never expose this to the browser and never import it from a Client
// Component; `server-only` enforces this at build time.
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
