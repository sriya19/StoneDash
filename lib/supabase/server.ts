import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// Server client for Server Components, Route Handlers, and Server Actions.
// Reads the user's session from request cookies; RLS is enforced via the
// user's JWT.
export function createSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(newCookies) {
          try {
            newCookies.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Cookies are read-only inside a Server Component render. The
            // middleware handles session refresh, so swallowing here is safe.
          }
        },
      },
    },
  );
}
