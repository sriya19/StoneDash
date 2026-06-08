// DOM-level smoke for portal-mounted Send-to-crew buttons (Task 3.1 sub-step 7b).
//
// Why this exists: scripts/smoke_pages.ts greps the SSR response body for
// `data-testid="send-to-crew"`. That covers calendar event blocks + list
// view rows (rendered server-side). It CANNOT cover:
//   * The order detail Sheet's Events tab (Radix Sheet portals to
//     document.body, which doesn't exist server-side).
//   * The EventDialog footer's Send button (same — Radix Dialog portal).
// So we boot a real chromium via playwright, navigate to each URL, wait
// for hydration, and assert the testid is in the live DOM.
//
// PLAN Q7 lock: "sub-step 7b doesn't ship until SOMETHING covers it."
// This is that.
//
// Graceful skip: if playwright's chromium isn't installed (one-time setup
// with `npx playwright install chromium`), the script prints a warning
// and exits 0. So devs without playwright can still run the SSR smoke.
//
// Usage:
//   pnpm dev               # in another terminal
//   pnpm smoke:dom
// or, indirectly, via `pnpm smoke` which chains SSR → DOM.

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type CookieJar = Map<string, string>;

async function signInAndCollectCookies(jar: CookieJar): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const sb = createServerClient(url, anon, {
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
  const { error } = await sb.auth.signInWithPassword({
    email: "owner@topmarble.local",
    password: "StoneDemo!2026",
  });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
}

async function main() {
  const devUrl = process.env.DEV_URL ?? "http://localhost:3000";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !service) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }

  // Resolve dynamic ids from the seeded DB.
  const admin = createClient(supabaseUrl, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // Pick an event that's actually tied to an order — that order's Events
  // tab will then have at least one row with the Send button.
  const { data: ev } = await admin
    .from("order_events")
    .select("id, order_id")
    .not("order_id", "is", null)
    .limit(1)
    .maybeSingle<{ id: string; order_id: string }>();
  if (!ev) {
    process.stderr.write("DOM smoke: no seeded order-tied event found — run `pnpm db:seed`.\n");
    process.exit(1);
  }
  const order = { id: ev.order_id };

  // Lazy-import playwright so the script still loads on machines without it.
  let chromium: typeof import("playwright")["chromium"];
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    process.stdout.write(
      "DOM smoke: playwright not installed — skipping. Install with `pnpm add -D playwright && npx playwright install chromium`.\n",
    );
    process.exit(0);
  }

  let browser: import("playwright").Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Executable doesn't exist") || msg.includes("chromium")) {
      process.stdout.write(
        "DOM smoke: chromium binary missing — skipping. Install with `npx playwright install chromium`.\n",
      );
      process.exit(0);
    }
    throw err;
  }

  const jar: CookieJar = new Map();
  await signInAndCollectCookies(jar);
  // Translate jar → playwright cookies. Domain must match the dev URL host.
  const host = new URL(devUrl).hostname;
  const cookies = Array.from(jar.entries()).map(([name, value]) => ({
    name,
    value,
    domain: host,
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  }));

  const context = await browser.newContext();
  await context.addCookies(cookies);

  type Target = { url: string; description: string };
  const targets: Target[] = [
    {
      url: `${devUrl}/orders?order=${order.id}&tab=events`,
      description: "Order detail Sheet — Events tab",
    },
    {
      url: `${devUrl}/schedule?event=${ev.id}`,
      description: "EventDialog footer (on /schedule)",
    },
    {
      url: `${devUrl}/orders?order=${order.id}&tab=events&event=${ev.id}`,
      description: "EventDialog footer (on /orders)",
    },
  ];

  let failed = 0;
  for (const target of targets) {
    const page = await context.newPage();
    try {
      await page.goto(target.url, { waitUntil: "networkidle", timeout: 15000 });
      // Wait for the portal to mount the Send-to-crew testid. Some Radix
      // animations delay mount by a frame; 3s ceiling is generous.
      try {
        await page.waitForSelector('[data-testid="send-to-crew"]', { timeout: 3000 });
      } catch {
        // fall through to count check
      }
      const count = await page.locator('[data-testid="send-to-crew"]').count();
      if (count > 0) {
        process.stdout.write(`[OK     ] ${count}× testid  ${target.description}\n`);
      } else {
        failed++;
        process.stdout.write(`[FAIL   ] 0 testid     ${target.description}  (${target.url})\n`);
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`[FAIL   ] error        ${target.description}  (${msg})\n`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  process.stdout.write(`\n${targets.length} target(s): ${targets.length - failed} OK, ${failed} FAIL\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`DOM smoke FAILED: ${msg}\n`);
  process.exit(1);
});
