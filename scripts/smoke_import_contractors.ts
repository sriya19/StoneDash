// End-to-end smoke for POST /api/import/contractors. Same shape as
// smoke_import_customers.ts — uploads a 5-row CSV (3 valid, 1 bad
// email, 1 empty name), checks the response, verifies the DB, and
// cleans up after itself via service-role.

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

type CookieJar = Map<string, string>;

const NAME_PREFIX = "__SMOKE_CONTRACTOR__";

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
  await admin.from("contractors").delete().ilike("name", `${NAME_PREFIX}%`);
}

async function main() {
  const devUrl = process.env.DEV_URL ?? "http://localhost:3000";
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set (cleanup needs it)");
  }

  await cleanup();

  const jar: CookieJar = new Map();
  await signIn(jar);
  const cookieHeader = Array.from(jar.entries())
    .map(([n, v]) => `${n}=${v}`)
    .join("; ");

  const csv =
    "Contractor Name,Primary Contact,Email,Payment Terms\n" +
    `${NAME_PREFIX}Alpha Builders,Alice,alice@example.com,Net 30\n` +
    `${NAME_PREFIX}Beta Construction,Bob,bob@example.com,Net 60\n` +
    `${NAME_PREFIX}Gamma Group,Charlie,charlie@example.com,Running tab\n` +
    `${NAME_PREFIX}Delta Dealers,Dave,not-an-email,Net 30\n` +
    `,Echo,echo@example.com,Net 30\n`;

  const mapping = {
    "Contractor Name": "name",
    "Primary Contact": "primaryContact",
    Email: "email",
    "Payment Terms": "paymentTerms",
  };

  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "contractors.csv");
  form.append("mapping", JSON.stringify(mapping));

  const res = await fetch(`${devUrl}/api/import/contractors`, {
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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: rows, error } = await admin
    .from("contractors")
    .select("name, payment_terms")
    .ilike("name", `${NAME_PREFIX}%`);
  if (error) {
    process.stderr.write(`db read failed: ${error.message}\n`);
    await cleanup();
    process.exit(1);
  }
  checks.push([
    "DB has 3 inserted contractors",
    (rows?.length ?? 0) === 3,
    String(rows?.length ?? 0),
  ]);
  checks.push([
    "payment_terms preserved",
    (rows ?? []).every((r) =>
      ["Net 30", "Net 60", "Running tab"].includes(r.payment_terms as string),
    ),
    JSON.stringify((rows ?? []).map((r) => r.payment_terms)),
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
  process.stderr.write(`import-contractors smoke FAILED: ${msg}\n`);
  await cleanup().catch(() => {});
  process.exit(1);
});
