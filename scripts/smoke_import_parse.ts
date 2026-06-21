// Smoke for POST /api/import/parse — signs in as demo owner, uploads a
// tiny CSV with one CSV-injection cell, expects:
//   * headers in alpha order from the file
//   * 3 total rows
//   * 1 sanitized cell (the leading `=`)
//   * preview slice contains all 3 rows
//
// Why this is a separate script (not part of smoke_pages.ts): the
// pages smoke is GET-only and cookie-driven. This needs POST +
// multipart, and the response shape is JSON not HTML. Cleaner as
// its own script, chained from `pnpm smoke:import`.

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

async function main() {
  const devUrl = process.env.DEV_URL ?? "http://localhost:3000";
  const jar: CookieJar = new Map();
  await signIn(jar);
  const cookieHeader = Array.from(jar.entries())
    .map(([n, v]) => `${n}=${v}`)
    .join("; ");

  // Cell 2 of row 1 starts with `=` — should be sanitized to `SUM(...)`.
  const csv =
    "name,company,phone\n" +
    "Alice,=SUM(A1:A9),555-0001\n" +
    "Bob,Acme,555-0002\n" +
    "Charlie,Globex,555-0003\n";

  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "sample.csv");

  const res = await fetch(`${devUrl}/api/import/parse`, {
    method: "POST",
    body: form,
    headers: { Cookie: cookieHeader },
  });

  if (res.status !== 200) {
    process.stderr.write(`FAIL: HTTP ${res.status}\n${await res.text()}\n`);
    process.exit(1);
  }

  const body = (await res.json()) as {
    ok: boolean;
    headers: string[];
    rows: Record<string, string>[];
    totalRows: number;
    sanitizedCells: number;
  };

  const expected = {
    headers: ["name", "company", "phone"],
    totalRows: 3,
    previewLen: 3,
    sanitizedCells: 1,
    sanitizedCompany: "SUM(A1:A9)",
  };

  const checks: Array<[string, boolean, string]> = [
    ["ok", body.ok === true, String(body.ok)],
    ["headers", JSON.stringify(body.headers) === JSON.stringify(expected.headers), JSON.stringify(body.headers)],
    ["totalRows", body.totalRows === expected.totalRows, String(body.totalRows)],
    ["previewLen", body.rows.length === expected.previewLen, String(body.rows.length)],
    ["sanitizedCells", body.sanitizedCells === expected.sanitizedCells, String(body.sanitizedCells)],
    [
      "sanitizedCompany",
      body.rows[0]?.company === expected.sanitizedCompany,
      String(body.rows[0]?.company),
    ],
  ];

  let failed = 0;
  for (const [name, ok, actual] of checks) {
    if (ok) process.stdout.write(`[OK     ] ${name}\n`);
    else {
      process.stdout.write(`[FAIL   ] ${name} = ${actual}\n`);
      failed += 1;
    }
  }

  process.stdout.write(`\n${checks.length} check(s): ${checks.length - failed} OK, ${failed} FAIL\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`import-parse smoke FAILED: ${msg}\n`);
  process.exit(1);
});
