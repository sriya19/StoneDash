// Capture the canonical "current state" screenshots for the README +
// docs/screenshots/. Re-run after any visual change you want to land
// in the docs. Writes 5 PNGs at 1280×800, deviceScaleFactor 2.
//
// Task 8 added WIDTHS / THEMES / OUT so the same script covers the
// responsive + dark-mode verification pass instead of a throwaway
// alongside it. Defaults are unchanged: one 1280px light run writing the
// canonical five, so `pnpm tsx scripts/capture_docs_screenshots.ts` with
// no env still does exactly what it did before. Any run that is not a
// single light 1280 pass suffixes filenames with `-<theme>-<width>` so a
// verification sweep can never silently overwrite the committed set.
//
// Usage:
//   pnpm dev                 # in another terminal
//   pnpm tsx --env-file=.env.local scripts/capture_docs_screenshots.ts
//
//   # verification sweep — 3 widths × both themes, kept out of docs/
//   WIDTHS=375,768,1280 THEMES=light,dark OUT=/tmp/shots \
//     pnpm tsx --env-file=.env.local scripts/capture_docs_screenshots.ts

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

function parseList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  const parts = value.split(",").map((v) => v.trim()).filter(Boolean);
  return parts.length > 0 ? parts : fallback;
}

async function main() {
  const devUrl = process.env.DEV_URL ?? "http://localhost:3000";
  const outDir = path.resolve(process.cwd(), process.env.OUT ?? "docs/screenshots");
  const widths = parseList(process.env.WIDTHS, ["1280"]).map((w) => {
    const n = Number.parseInt(w, 10);
    if (!Number.isFinite(n) || n < 320 || n > 3840) {
      throw new Error(`WIDTHS: ${w} is not a viewport width between 320 and 3840`);
    }
    return n;
  });
  const themes = parseList(process.env.THEMES, ["light"]).map((t) => {
    if (t !== "light" && t !== "dark") {
      throw new Error(`THEMES: ${t} is not "light" or "dark"`);
    }
    return t;
  });
  // Only the default single light-1280 pass owns the canonical filenames.
  const canonical = widths.length === 1 && widths[0] === 1280
    && themes.length === 1 && themes[0] === "light";
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

  for (const theme of themes) {
    for (const width of widths) {
      // next-themes reads `theme` from localStorage and stamps a class on
      // <html>; colorScheme alone only drives prefers-color-scheme, which
      // this app does not follow once a preference is stored.
      const makeCtx = async (authed: boolean) => {
        const ctx = await browser.newContext({
          viewport: { width, height: 800 },
          deviceScaleFactor: 2,
          colorScheme: theme,
        });
        await ctx.addInitScript(
          `try { window.localStorage.setItem("theme", ${JSON.stringify(theme)}); } catch {}`,
        );
        if (authed) await ctx.addCookies(cookies);
        return ctx;
      };
      const authedCtx = await makeCtx(true);
      const anonCtx = await makeCtx(false);

      for (const shot of shots) {
        const ctx = shot.authed ? authedCtx : anonCtx;
        const page = await ctx.newPage();
        await page.goto(shot.url, { waitUntil: "networkidle", timeout: 30_000 });
        if (shot.waitMs) await page.waitForTimeout(shot.waitMs);
        const name = canonical
          ? shot.name
          : shot.name.replace(/\.png$/, `-${theme}-${width}.png`);
        const out = path.join(outDir, name);
        await page.screenshot({ path: out, type: "png" });
        await page.close();
        process.stdout.write(`captured ${out}\n`);
      }

      await authedCtx.close();
      await anonCtx.close();
    }
  }

  await browser.close();
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`capture failed: ${msg}\n`);
  process.exit(1);
});
