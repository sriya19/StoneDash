// End-to-end smoke for POST /api/import/customers. Signs in as demo
// owner, uploads a tiny customer CSV (with one row that should fail
// validation — an invalid email — to verify the skipped + warnings
// path), checks the response, then deletes the inserted rows via the
// service-role client so the smoke is repeatable without polluting
// demo data.

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

type CookieJar = Map<string, string>;

const NAME_PREFIX = "__SMOKE_CUSTOMER__";

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

async function cleanup(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await admin.from("customers").delete().ilike("name", `${NAME_PREFIX}%`);
}

async function main() {
  const devUrl = process.env.DEV_URL ?? "http://localhost:3000";
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set (cleanup needs it)");
  }

  // Wipe any leftovers from a prior failed run before we start so the
  // assertions match the rows from THIS run.
  await cleanup();

  const jar: CookieJar = new Map();
  await signIn(jar);
  const cookieHeader = Array.from(jar.entries())
    .map(([n, v]) => `${n}=${v}`)
    .join("; ");

  // 3 valid rows + 1 with a broken email + 1 with empty name (Zod min(1)).
  // The empty-name row should be skipped with a "Name is required" warning.
  // The broken-email row should be skipped with an "Invalid email" warning.
  const csv =
    "Customer Name,Company,Email,Phone\n" +
    `${NAME_PREFIX}Alice,Alpha LLC,alice@example.com,555-0101\n` +
    `${NAME_PREFIX}Bob,Beta LLC,bob@example.com,555-0102\n` +
    `${NAME_PREFIX}Charlie,Gamma LLC,charlie@example.com,555-0103\n` +
    `${NAME_PREFIX}Dave,Delta LLC,not-an-email,555-0104\n` +
    `,Echo LLC,echo@example.com,555-0105\n`;

  const mapping = {
    "Customer Name": "name",
    Company: "company",
    Email: "email",
    Phone: "phone",
  };

  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "customers.csv");
  form.append("mapping", JSON.stringify(mapping));

  const res = await fetch(`${devUrl}/api/import/customers`, {
    method: "POST",
    body: form,
    headers: { Cookie: cookieHeader },
  });

  if (res.status !== 200) {
    process.stderr.write(`FAIL: HTTP ${res.status}\n${await res.text()}\n`);
    await cleanup();
    process.exit(1);
  }

  const body = (await res.json()) as {
    ok: boolean;
    inserted: number;
    skipped: number;
    warnings: string[];
  };

  const checks: Array<[string, boolean, string]> = [
    ["ok", body.ok === true, String(body.ok)],
    ["inserted=3", body.inserted === 3, String(body.inserted)],
    ["skipped=2", body.skipped === 2, String(body.skipped)],
    [
      "warning mentions Invalid email",
      body.warnings.some((w) => w.toLowerCase().includes("invalid email")),
      JSON.stringify(body.warnings),
    ],
    [
      "warning mentions Name is required",
      body.warnings.some((w) => w.toLowerCase().includes("name is required")),
      JSON.stringify(body.warnings),
    ],
  ];

  // Verify the rows actually exist via service-role read.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: rows, error } = await admin
    .from("customers")
    .select("name")
    .ilike("name", `${NAME_PREFIX}%`);
  if (error) {
    process.stderr.write(`db read failed: ${error.message}\n`);
    await cleanup();
    process.exit(1);
  }
  checks.push([
    "DB has 3 inserted customers",
    (rows?.length ?? 0) === 3,
    String(rows?.length ?? 0),
  ]);

  let failed = 0;
  for (const [name, ok, actual] of checks) {
    if (ok) process.stdout.write(`[OK     ] ${name}\n`);
    else {
      process.stdout.write(`[FAIL   ] ${name} = ${actual}\n`);
      failed += 1;
    }
  }

  process.stdout.write(`\n${checks.length} check(s): ${checks.length - failed} OK, ${failed} FAIL\n`);
  await cleanup();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`import-customers smoke FAILED: ${msg}\n`);
  await cleanup().catch(() => {});
  process.exit(1);
});
