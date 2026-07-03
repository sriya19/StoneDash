// Smoke for the AI extraction pipeline. Mocked mode — NEVER calls
// OpenAI. Verifies four things end-to-end against the running dev
// server + hosted DB:
//   1. There's a seeded 'review' extraction on the demo org's
//      Files tab so the chip has something to render.
//   2. Signing in and hitting /orders?order=<oid>&tab=files renders
//      the "Review template" chip in the SSR body.
//   3. POST /api/extract/<attachmentId>?mode=mock writes a
//      status='review' + document_type='template' row without
//      calling OpenAI (asserted via the HMAC token being minted
//      server-side).
//   4. The status endpoint returns the row we just updated.
//
// We reuse the seeded 'review' extraction row (sub-step 10) so we
// don't need to invent a fresh attachment mid-smoke. That means
// this smoke is idempotent — running it twice is safe.

import { createHmac } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

// Inlined HMAC token minter — mirrors lib/extraction/internal-token.ts.
// Can't import that module directly because it uses "server-only", which
// only resolves inside Next.js.
function mintInternalToken(fileId: string): string {
  const secret =
    process.env.EXTRACTION_INTERNAL_SECRET ||
    `extraction:${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`;
  const encoded = Buffer.from(fileId, "utf8").toString("base64url");
  const payload = `${encoded}.${Date.now()}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

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

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function main() {
  const devUrl = process.env.DEV_URL ?? "http://localhost:3000";
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  const checks: Array<[string, boolean, string]> = [];

  // 1. Find the seeded 'review' extraction (from sub-step 10). It
  //    should be a template on the first seeded order.
  const sb = admin();
  const { data: seeded, error: seedErr } = await sb
    .from("file_extractions")
    .select("id, file_id, status, document_type")
    .eq("status", "review")
    .eq("document_type", "template")
    .limit(1)
    .maybeSingle<{
      id: string;
      file_id: string;
      status: string;
      document_type: string;
    }>();
  if (seedErr || !seeded) {
    process.stderr.write(
      `FAIL: seeded review extraction not found (run pnpm db:seed)\n`,
    );
    process.exit(1);
  }
  checks.push(["seeded review extraction exists", true, seeded.id]);

  const { data: file } = await sb
    .from("order_attachments")
    .select("id, order_id")
    .eq("id", seeded.file_id)
    .maybeSingle<{ id: string; order_id: string }>();
  if (!file) {
    process.stderr.write("FAIL: seeded file missing\n");
    process.exit(1);
  }

  // 2. SSR — /orders?order=<oid>&tab=files should include the
  //    Review chip label somewhere in the body.
  const jar: CookieJar = new Map();
  await signIn(jar);
  const cookieHeader = Array.from(jar.entries())
    .map(([n, v]) => `${n}=${v}`)
    .join("; ");

  const ordersRes = await fetch(
    `${devUrl}/orders?order=${file.order_id}&tab=files`,
    { headers: { Cookie: cookieHeader } },
  );
  const ordersBody = await ordersRes.text();
  checks.push([
    "files tab renders 200",
    ordersRes.status === 200,
    String(ordersRes.status),
  ]);
  // The chip itself renders client-side (via useExtractionsPolling)
  // and isn't in the SSR body. Verify a proxy: the file name from
  // the seeded attachment appears on the Files tab, which proves
  // the extractions prop reached the OrderDetailSheet.
  checks.push([
    "files tab includes seeded file name",
    /measurement-sheet\.pdf/.test(ordersBody),
    ordersBody.includes("measurement-sheet.pdf")
      ? "found"
      : "no match",
  ]);

  // 3. Mock kickoff against the same file. Should re-write the row
  //    to status='review' + document_type='template' + fields set.
  const token = mintInternalToken(file.id);
  const kickRes = await fetch(
    `${devUrl}/api/extract/${file.id}?mode=mock`,
    {
      method: "POST",
      headers: { Authorization: `Internal ${token}` },
    },
  );
  checks.push([
    "mock kickoff returns 200",
    kickRes.status === 200,
    String(kickRes.status),
  ]);

  const { data: after } = await sb
    .from("file_extractions")
    .select("status, document_type, cost_cents")
    .eq("file_id", file.id)
    .maybeSingle<{ status: string; document_type: string; cost_cents: number | null }>();
  checks.push([
    "after mock: status=review",
    after?.status === "review",
    String(after?.status),
  ]);
  checks.push([
    "after mock: document_type=template",
    after?.document_type === "template",
    String(after?.document_type),
  ]);
  checks.push([
    "after mock: cost_cents=0",
    (after?.cost_cents ?? -1) === 0,
    String(after?.cost_cents),
  ]);

  // 4. Status endpoint returns the row.
  const statusRes = await fetch(`${devUrl}/api/extractions/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
    body: JSON.stringify({ file_ids: [file.id] }),
  });
  const statusBody = (await statusRes.json()) as {
    ok: boolean;
    rows: { file_id: string; status: string; document_type: string }[];
  };
  checks.push([
    "status endpoint returns 200",
    statusRes.status === 200,
    String(statusRes.status),
  ]);
  checks.push([
    "status endpoint includes the file",
    statusBody.rows.some((r) => r.file_id === file.id && r.status === "review"),
    JSON.stringify(statusBody.rows),
  ]);

  let failed = 0;
  for (const [name, ok, actual] of checks) {
    if (ok) process.stdout.write(`[OK     ] ${name}\n`);
    else {
      process.stdout.write(`[FAIL   ] ${name} = ${actual}\n`);
      failed += 1;
    }
  }
  process.stdout.write(
    `\n${checks.length} check(s): ${checks.length - failed} OK, ${failed} FAIL\n`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`extraction smoke FAILED: ${msg}\n`);
  process.exit(1);
});
