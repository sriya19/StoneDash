import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

// Turn a Supabase query error into a loud exception instead of silently
// treating it as "no row". A policy misconfiguration that returns an error
// from `.maybeSingle()` / `.select()` (e.g. RLS denying access to a
// referenced table) would otherwise look identical to "row doesn't exist",
// which previously masked an RLS bug as a /dashboard <-> /onboarding
// redirect loop. Always pass through this helper when the query's result
// drives an auth or onboarding gate decision.
export function assertNoQueryError(
  queryName: string,
  error: PostgrestError | null,
): void {
  if (!error) return;
  // eslint-disable-next-line no-console
  console.error(
    `[supabase] ${queryName} failed: code=${error.code ?? "?"} message=${error.message}`,
  );
  throw new Error(
    `Supabase query "${queryName}" failed (${error.code ?? "unknown"}): ${error.message}`,
  );
}
