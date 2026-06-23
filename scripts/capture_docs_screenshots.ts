// Capture the canonical "current state" screenshots for the README +
// docs/screenshots/. Re-run after any visual change you want to land
// in the docs. Writes 5 PNGs at 1280×800, deviceScaleFactor 2.
//
// Usage:
//   pnpm dev                 # in another terminal
//   pnpm tsx --env-file=.env.local scripts/capture_docs_screenshots.ts

import path from "node:path";
import { mkdir } from "node:fs/promises";

import { createServerClient } from "@supabase/ssr";

type CookieJar = Map<string, string>;

async function signIn(jar: CookieJar): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const sb = createServerClient(url, anon, {
    cookies: {
      getAll: () =>
        Array.from(jar.entries()).map(([name, value]) => ({ name, value })),
      setAll: (next) => {
        for (const { name, value } of next) {
          if (!value) jar.delete(name);
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

type Shot = {
  name: string;
  url: string;
  // Authenticated routes need cookies; the public landing + login do not.
  authed: boolean;
  // Some surfaces (Sheet portals) need a brief wait past networkidle.
  waitMs?: number;
};

async function main() {
  const devUrl = process.env.DEV_URL ?? "http://localhost:3000";
  const outDir = path.resolve(process.cwd(), "docs/screenshots");
  await mkdir(outDir, { recursive: true });

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  // Authed context — used for /dashboard, /orders, /customers, /orders?quick=1.
  const jar: CookieJar = new Map();
  await signIn(jar);
  const cookies = Array.from(jar.entries()).map(([n, v]) => ({
    name: n,
    value: v,
    domain: "localhost",
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  }));

  const authedCtx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });
  await authedCtx.addCookies(cookies);

  // Anonymous context — for the public landing and the login page (so
  // the screenshots match what a brand-new visitor sees).
  const anonCtx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });

  const shots: Shot[] = [
    { name: "landing.png", url: `${devUrl}/`, authed: false, waitMs: 600 },
    { name: "login.png", url: `${devUrl}/login`, authed: false, waitMs: 400 },
    { name: "dashboard.png", url: `${devUrl}/dashboard`, authed: true, waitMs: 400 },
    { name: "orders.png", url: `${devUrl}/orders`, authed: true, waitMs: 400 },
    {
      name: "quick-add.png",
      url: `${devUrl}/orders?quick=1`,
      authed: true,
      waitMs: 700,
    },
  ];

  for (const shot of shots) {
    const ctx = shot.authed ? authedCtx : anonCtx;
    const page = await ctx.newPage();
    await page.goto(shot.url, { waitUntil: "networkidle", timeout: 30_000 });
    if (shot.waitMs) await page.waitForTimeout(shot.waitMs);
    const out = path.join(outDir, shot.name);
    await page.screenshot({ path: out, type: "png" });
    await page.close();
    process.stdout.write(`captured ${out}\n`);
  }

  await browser.close();
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`capture failed: ${msg}\n`);
  process.exit(1);
});
