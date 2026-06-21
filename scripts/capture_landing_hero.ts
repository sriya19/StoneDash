// One-shot capture of the redesigned /dashboard for the marketing hero.
//
// Output: public/landing/dashboard-hero.png at 1280×800 (matches the
// hero's 16:10 placeholder so layout doesn't shift when the PNG lands).
//
// Re-run whenever the dashboard design changes meaningfully — it's a
// committed binary, so don't run it on every build, only when you
// genuinely want a new screenshot.
//
// Usage:
//   pnpm dev                 # in another terminal — seeded demo data
//   pnpm tsx scripts/capture_landing_hero.ts
//
// Requires the same playwright setup as the DOM smoke (sub-step 7b of
// Task 3.1). If chromium isn't installed, the script exits with a clear
// error rather than silently shipping a stale PNG.

import path from "node:path";
import { mkdir } from "node:fs/promises";

import { createServerClient } from "@supabase/ssr";

type CookieJar = Map<string, string>;

async function signInAndCollectCookies(jar: CookieJar): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set",
    );
  }
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
  const outDir = path.resolve(process.cwd(), "public/landing");
  const outPath = path.join(outDir, "dashboard-hero.png");

  await mkdir(outDir, { recursive: true });

  let chromium: typeof import("playwright")["chromium"];
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    process.stderr.write(
      "capture_landing_hero: playwright not installed. Run `pnpm add -D playwright && npx playwright install chromium`.\n",
    );
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });

  const jar: CookieJar = new Map();
  await signInAndCollectCookies(jar);
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

  // 1280×800 is the eventual placeholder aspect (16:10). Device scale
  // factor 2 = retina-quality output without inflating the PNG more than
  // necessary for a hero shot.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });
  await context.addCookies(cookies);

  const page = await context.newPage();
  await page.goto(`${devUrl}/dashboard`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });

  // Brief settle for any client-side hydration (the dashboard is mostly
  // server-rendered, but Sonner toaster + theme provider mount client-
  // side; an extra 400ms beat avoids capturing a half-painted state).
  await page.waitForTimeout(400);

  await page.screenshot({ path: outPath, type: "png" });
  await browser.close();

  process.stdout.write(`captured ${outPath} (1280×800)\n`);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`capture failed: ${msg}\n`);
  process.exit(1);
});
