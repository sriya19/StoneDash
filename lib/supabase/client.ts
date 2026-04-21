import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client, used inside Client Components for auth flows
// (login/signup/signout) and any realtime subscriptions we add later. RLS is
// enforced by the user's JWT stored in cookies.
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  );
}
