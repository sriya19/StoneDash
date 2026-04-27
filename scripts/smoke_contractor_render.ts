// Renders every contractor route through a running dev/start server with
// a real authenticated session, then fails on any 5xx or known
// runtime-error substring.
//
// Why it exists: `pnpm typecheck`, `next lint`, and `next build` all pass
// when a server component imports a non-component value from a
// `"use client"` module — the import is rewritten at runtime to a client
// reference proxy, which fails on call-time only. Dynamic routes (the ƒ
// rows in the build output) are never prerendered so `next build` can't
// catch it. The dev/start server is the only gate that does.
//
// How auth works: signs in via @supabase/ssr's createServerClient with an
// in-memory cookie jar (no fs writes). The resulting cookies are sent on
// each fetch as the Cookie header.
//
// Usage:
//   pnpm dev        # leave running in another terminal
//   pnpm tsx --env-file=.env.local scripts/smoke_contractor_render.ts
//   # default DEV_URL is http://localhost:3000; override if your dev
//   # server fell back to 3001 because something else is on 3000.

import { createServerClient } from "@supabase/ssr";

type CookieJar = Map<string, string>;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const devUrl = process.env.DEV_URL ?? "http://localhost:3000";

  const jar: CookieJar = new Map();

  // SSR client wired to our in-memory jar.
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

  const { error } = await supabase.auth.signInWithPassword({
    email: "owner@topmarble.local",
    password: "StoneDemo!2026",
  });
  if (error) throw new Error(`signin failed: ${error.message}`);

  if (jar.size === 0) {
    throw new Error("expected SSR auth cookies after signin, jar is empty");
  }

  // Look up a contractor id so we can hit the detail page.
  const { data: contractor, error: cErr } = await supabase
    .from("contractors")
    .select("id")
    .eq("name", "Ameer Construction")
    .maybeSingle<{ id: string }>();
  if (cErr) throw cErr;
  if (!contractor) throw new Error("Ameer not found — re-run pnpm db:seed");

  const cookieHeader = Array.from(jar.entries())
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");

  const targets = [
    `/contractors`,
    `/contractors?new=1`,
    `/contractors/${contractor.id}`,
    `/contractors/${contractor.id}?tab=payments`,
    `/contractors/${contractor.id}?tab=details`,
    `/contractors/${contractor.id}?payment=new`,
  ];

  let failed = 0;
  for (const path of targets) {
    const res = await fetch(`${devUrl}${path}`, {
      headers: { Cookie: cookieHeader },
      redirect: "manual",
    });
    const body = await res.text();

    // Things to flag in the body. Next dev injects the error overlay
    // markup when a render throws — the substring "is not a function"
    // shows up when we hit the original bug, alongside Next-specific
    // error wrappers.
    const errorSignals = [
      "balanceClass) is not a function",
      "is not a function",
      "Server Error",
      "Application error: a server-side exception",
    ];
    const hits = errorSignals.filter((s) => body.includes(s));

    const ok = res.status >= 200 && res.status < 400 && hits.length === 0;
    process.stdout.write(
      `[${ok ? "OK " : "FAIL"}] ${res.status} ${path}` +
        (hits.length ? `  (${hits.join(", ")})` : "") +
        "\n",
    );
    if (!ok) {
      failed++;
      if (hits.length) {
        // Print a short window around the first hit so the failure mode
        // is debuggable without re-running.
        const idx = body.indexOf(hits[0] ?? "");
        const window = body.slice(Math.max(0, idx - 200), idx + 400);
        process.stdout.write(`---\n${window}\n---\n`);
      }
    }
  }

  if (failed > 0) {
    process.stderr.write(`\n${failed} target(s) failed.\n`);
    process.exit(1);
  }
  process.stdout.write("\nall pages rendered without runtime errors.\n");
}

main().catch((err) => {
  process.stderr.write(
    `render check FAILED: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
