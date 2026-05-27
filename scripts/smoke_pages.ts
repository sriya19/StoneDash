// Render-time smoke check across every (app) route surface.
//
// Why it exists: pnpm typecheck, next lint, and next build all pass when a
// server component imports a non-component value from a "use client" module
// (the import is rewritten at runtime to a client-reference proxy and fails
// at call-time only). Dynamic routes are never prerendered, so next build
// can't catch this. A running dev/start server is the only gate that does.
// First demonstrated by the Task 2B balanceClass bug; preserved here.
//
// Generalized in sub-step 2 of Task 3 to take a route list. Each subsequent
// sub-step that ships a new page adds an entry here. The smoke covers:
//   * static routes (e.g. /dashboard)
//   * dynamic routes with a resolver that looks up a real DB id/slug
//   * the /j/:slug share-link matrix (valid/revoked/fake) per PLAN ADD-1
//
// Auth: signs in via @supabase/ssr with an in-memory cookie jar, same shape
// as the previous smoke_contractor_render.ts. Service-role lookups for
// resolvers happen separately.
//
// Usage:
//   pnpm dev                       # leave running in another terminal
//   pnpm smoke                     # run the full default list
//   pnpm smoke /contractors        # only routes starting with /contractors
//   pnpm smoke /j /schedule        # multiple prefixes
//
// Exit codes: 0 on full pass, 1 on any FAIL. SKIP / PENDING are non-fatal.

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Route = {
  path: string; // may include :name placeholders for human-readable diagnostics
  resolver?: (admin: SupabaseClient) => Promise<string | null>;
  expectStatus?: number; // default: 200
  expectBody?: string; // substring to assert; case-sensitive
  // pending: route is expected to 404 right now because the sub-step that
  // implements it hasn't landed yet. The smoke still hits it; if it returns
  // anything other than 404, the script prints a "remove pending flag" nudge.
  pending?: boolean;
  description?: string;
};

const ERROR_SIGNALS = [
  "is not a function",
  "Server Error",
  "Application error: a server-side exception",
];

async function resolveContractorId(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin
    .from("contractors")
    .select("id")
    .limit(1)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

async function resolveValidSlug(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin
    .from("event_share_links")
    .select("slug")
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle<{ slug: string }>();
  return data?.slug ?? null;
}

async function resolveRevokedSlug(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin
    .from("event_share_links")
    .select("slug")
    .not("revoked_at", "is", null)
    .limit(1)
    .maybeSingle<{ slug: string }>();
  return data?.slug ?? null;
}

const ROUTES: Route[] = [
  { path: "/dashboard" },
  { path: "/orders" },
  { path: "/orders?new=1" },
  {
    path: "/orders?order=:orderId&tab=events",
    resolver: async (a) => {
      const { data } = await a
        .from("orders")
        .select("id")
        .limit(1)
        .maybeSingle<{ id: string }>();
      return data?.id ? `/orders?order=${data.id}&tab=events` : null;
    },
  },
  {
    path: "/orders?order=:orderId&tab=events&event=new",
    resolver: async (a) => {
      const { data } = await a
        .from("orders")
        .select("id")
        .limit(1)
        .maybeSingle<{ id: string }>();
      return data?.id ? `/orders?order=${data.id}&tab=events&event=new` : null;
    },
  },
  { path: "/customers" },
  { path: "/customers?new=1" },
  { path: "/contractors" },
  { path: "/contractors?new=1" },
  {
    path: "/contractors/:contractorId",
    resolver: async (a) => {
      const id = await resolveContractorId(a);
      return id ? `/contractors/${id}` : null;
    },
  },
  {
    path: "/contractors/:contractorId?tab=payments",
    resolver: async (a) => {
      const id = await resolveContractorId(a);
      return id ? `/contractors/${id}?tab=payments` : null;
    },
  },
  {
    path: "/contractors/:contractorId?tab=details",
    resolver: async (a) => {
      const id = await resolveContractorId(a);
      return id ? `/contractors/${id}?tab=details` : null;
    },
  },

  { path: "/team" },
  { path: "/team?new=1" },
  {
    path: "/team?id=:crewId",
    resolver: async (a) => {
      const { data } = await a
        .from("crew_members")
        .select("id")
        .limit(1)
        .maybeSingle<{ id: string }>();
      return data?.id ? `/team?id=${data.id}` : null;
    },
  },

  { path: "/schedule" },
  { path: "/schedule?view=day" },
  { path: "/schedule?view=list" },
  { path: "/schedule?view=list&kind=install&status=scheduled" },
  { path: "/schedule?event=new" },
  {
    path: "/schedule?event=:eventId",
    resolver: async (a) => {
      const { data } = await a
        .from("order_events")
        .select("id")
        .limit(1)
        .maybeSingle<{ id: string }>();
      return data?.id ? `/schedule?event=${data.id}` : null;
    },
  },

  // PLAN ADD-1 matrix: valid → 200 + order number visible; revoked + fake
  // → uniform 404 with the "no longer active" copy. Seed creates one of
  // each so the resolvers find rows; the fake slug is hardcoded.
  {
    path: "/j/:slug-valid",
    resolver: async (a) => {
      const slug = await resolveValidSlug(a);
      return slug ? `/j/${slug}` : null;
    },
    expectBody: "TM-",
    description: "share-link valid case",
  },
  {
    path: "/j/:slug-revoked",
    resolver: async (a) => {
      const slug = await resolveRevokedSlug(a);
      return slug ? `/j/${slug}` : null;
    },
    expectStatus: 404,
    expectBody: "no longer active",
    description: "share-link revoked case",
  },
  {
    path: "/j/:slug-fake",
    resolver: async () => "/j/zzzzzzzzzzzzzzzz",
    expectStatus: 404,
    expectBody: "no longer active",
    description: "share-link fake case",
  },
  {
    path: "/orders?order=:orderId&tab=events&send=:eventId",
    resolver: async (a) => {
      const [{ data: order }, { data: ev }] = await Promise.all([
        a.from("orders").select("id").limit(1).maybeSingle<{ id: string }>(),
        a.from("order_events").select("id").limit(1).maybeSingle<{ id: string }>(),
      ]);
      if (!order || !ev) return null;
      return `/orders?order=${order.id}&tab=events&send=${ev.id}`;
    },
  },
];

type Result =
  | { kind: "ok"; path: string; status: number }
  | { kind: "skip"; path: string; reason: string }
  | { kind: "pending"; path: string; status: number; note: string }
  | {
      kind: "fail";
      path: string;
      status: number;
      reason: string;
      bodyWindow?: string;
    };

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const devUrl = process.env.DEV_URL ?? "http://localhost:3000";

  if (!url || !anon || !service) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }

  const filters = process.argv.slice(2);
  const filteredRoutes =
    filters.length === 0
      ? ROUTES
      : ROUTES.filter((r) => filters.some((f) => r.path.startsWith(f)));

  if (filteredRoutes.length === 0) {
    process.stderr.write(`no routes matched filter: ${filters.join(", ")}\n`);
    process.exit(1);
  }

  // SSR client wired to an in-memory cookie jar (no fs writes).
  const jar = new Map<string, string>();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () =>
        Array.from(jar.entries()).map(([name, value]) => ({ name, value })),
      setAll: (next) => {
        for (const { name, value } of next) {
          if (value === "") jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });

  const { error: signinErr } = await supabase.auth.signInWithPassword({
    email: "owner@topmarble.local",
    password: "StoneDemo!2026",
  });
  if (signinErr) throw new Error(`signin failed: ${signinErr.message}`);

  if (jar.size === 0) {
    throw new Error("expected SSR auth cookies after signin, jar is empty");
  }

  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const cookieHeader = Array.from(jar.entries())
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");

  // Probe the dev server first so a missing server gives a clear message.
  try {
    const probe = await fetch(`${devUrl}/`, { redirect: "manual" });
    void probe.status;
  } catch (err) {
    process.stderr.write(
      `cannot reach ${devUrl} — is the dev server running? (pnpm dev)\n${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    process.exit(1);
  }

  const results: Result[] = [];

  for (const route of filteredRoutes) {
    let resolved: string;
    if (route.resolver) {
      const r = await route.resolver(admin);
      if (r === null) {
        results.push({
          kind: "skip",
          path: route.path,
          reason: "resolver returned null (no DB row yet)",
        });
        continue;
      }
      resolved = r;
    } else {
      resolved = route.path;
    }

    const res = await fetch(`${devUrl}${resolved}`, {
      headers: { Cookie: cookieHeader },
      redirect: "manual",
    });
    const body = await res.text();
    const hits = ERROR_SIGNALS.filter((s) => body.includes(s));

    if (route.pending) {
      // pending = expected 404 until the implementing sub-step lands.
      if (res.status === 404) {
        results.push({
          kind: "pending",
          path: route.path,
          status: res.status,
          note: route.description ?? "pending",
        });
      } else {
        results.push({
          kind: "pending",
          path: route.path,
          status: res.status,
          note: `route now returns ${res.status}; remove pending flag`,
        });
      }
      continue;
    }

    const expectedStatus = route.expectStatus ?? 200;
    const statusOk = res.status === expectedStatus;
    const bodyOk =
      hits.length === 0 && (route.expectBody ? body.includes(route.expectBody) : true);

    if (statusOk && bodyOk) {
      results.push({ kind: "ok", path: route.path, status: res.status });
    } else {
      let reason = "";
      if (!statusOk) reason += `expected ${expectedStatus}, got ${res.status}; `;
      if (hits.length > 0) reason += `error markers: ${hits.join(", ")}; `;
      if (route.expectBody && !body.includes(route.expectBody)) {
        reason += `body missing "${route.expectBody}"; `;
      }
      let bodyWindow: string | undefined;
      if (hits.length > 0) {
        const idx = body.indexOf(hits[0] ?? "");
        bodyWindow = body.slice(Math.max(0, idx - 200), idx + 400);
      }
      results.push({
        kind: "fail",
        path: route.path,
        status: res.status,
        reason: reason.trim(),
        bodyWindow,
      });
    }
  }

  // Print results.
  let failed = 0;
  for (const r of results) {
    if (r.kind === "ok") {
      process.stdout.write(`[OK     ] ${r.status} ${r.path}\n`);
    } else if (r.kind === "skip") {
      process.stdout.write(`[SKIP   ] ----- ${r.path}  (${r.reason})\n`);
    } else if (r.kind === "pending") {
      process.stdout.write(`[PENDING] ${r.status} ${r.path}  (${r.note})\n`);
    } else {
      process.stdout.write(`[FAIL   ] ${r.status} ${r.path}  (${r.reason})\n`);
      if (r.bodyWindow) process.stdout.write(`---\n${r.bodyWindow}\n---\n`);
      failed++;
    }
  }

  process.stdout.write(
    `\n${results.length} route(s): ` +
      `${results.filter((r) => r.kind === "ok").length} OK, ` +
      `${results.filter((r) => r.kind === "skip").length} SKIP, ` +
      `${results.filter((r) => r.kind === "pending").length} PENDING, ` +
      `${failed} FAIL\n`,
  );

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(
    `smoke FAILED: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
