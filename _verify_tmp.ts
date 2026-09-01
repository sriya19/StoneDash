import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createServerClient } from "@supabase/ssr";

type CookieJar = Map<string, string>;
async function signIn(jar: CookieJar) {
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => Array.from(jar.entries()).map(([name, value]) => ({ name, value })),
      setAll: (n) => { for (const { name, value } of n) { if (!value) jar.delete(name); else jar.set(name, value); } },
    },
  });
  const { error } = await sb.auth.signInWithPassword({ email: "owner@topmarble.local", password: "StoneDemo!2026" });
  if (error) throw new Error(error.message);
}
async function main() {
  const OUT = process.env.OUT ?? "/tmp/task8-s5";
  const ROUTES = (process.env.SHOTS ?? "/schedule?view=week").split("|");
  const WIDTHS = (process.env.WIDTHS ?? "1280").split(",").map(Number);
  await mkdir(OUT, { recursive: true });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const jar: CookieJar = new Map();
  await signIn(jar);
  const cookies = Array.from(jar.entries()).map(([n, v]) => ({ name: n, value: v, domain: "localhost", path: "/" }));
  for (const theme of ["light", "dark"] as const) {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 2, colorScheme: theme });
      await ctx.addCookies(cookies);
      await ctx.addInitScript(`window.localStorage.setItem("theme","${theme}")`);
      const page = await ctx.newPage();
      for (const route of ROUTES) {
        await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(900);
        const name = route.replace(/[^a-zA-Z0-9]/g, "").slice(0, 28);
        await page.screenshot({ path: path.join(OUT, `${name}-${theme}-${width}.png`) });
      }
      await ctx.close();
    }
  }
  await browser.close();
  console.log("wrote", OUT);
}
main().catch((e) => { console.error(e); process.exit(1); });
