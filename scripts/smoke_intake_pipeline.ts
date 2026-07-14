// Mock-mode end-to-end smoke for the Task 6C intake pipeline.
// Exercises the full path WITHOUT calling OpenAI: seed a row →
// mock kickoff → poll status → verify extraction/matches/
// proposal landed in the DB.
//
// Companion to smoke_intake_real.ts (which does REAL calls
// against the fixtures). This one runs on every pnpm smoke
// invocation; the real one is a manual/on-demand chain via
// pnpm smoke:intake:real (kept off the default chain so
// nightly runs don't burn credits).

import { createHmac } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const NAME_PREFIX = "__SMOKE_INTAKE__";

function mintInternalToken(intakeId: string): string {
  const secret =
    process.env.EXTRACTION_INTERNAL_SECRET ||
    `extraction:${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`;
  const encoded = Buffer.from(intakeId, "utf8").toString("base64url");
  const payload = `${encoded}.${Date.now()}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function cleanup(): Promise<void> {
  const sb = admin();
  await sb
    .from("ai_intake_events")
    .delete()
    .ilike("storage_path", `%${NAME_PREFIX}%`);
}

async function main() {
  const devUrl = process.env.DEV_URL ?? "http://localhost:3000";
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  await cleanup();

  const sb = admin();
  const { data: org } = await sb
    .from("organizations")
    .select("id")
    .eq("slug", "top-marble-granite")
    .single<{ id: string }>();
  if (!org) throw new Error("demo org missing — pnpm db:seed first");

  const { data: user } = await sb
    .from("profiles")
    .select("id")
    .eq("active_org_id", org.id)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!user) throw new Error("demo owner missing");

  // Seed a processing intake row so the mock route has a target.
  const storagePath = `${org.id}/intake/${NAME_PREFIX}${Date.now()}.png`;
  const { data: seeded, error: seedErr } = await sb
    .from("ai_intake_events")
    .insert({
      org_id: org.id,
      uploaded_by: user.id,
      storage_path: storagePath,
      status: "processing",
    })
    .select("id")
    .single<{ id: string }>();
  if (seedErr || !seeded) {
    throw new Error(`seed insert failed: ${seedErr?.message ?? "unknown"}`);
  }

  // Fire the mocked kickoff (?fixture=whatsapp_new_job pins Step A
  // to a canned extraction; Steps B and C always run for real
  // per PLAN Q8).
  const token = mintInternalToken(seeded.id);
  const res = await fetch(
    `${devUrl}/api/intake/${seeded.id}?fixture=whatsapp_new_job`,
    {
      method: "POST",
      headers: { Authorization: `Internal ${token}` },
    },
  );

  const checks: Array<[string, boolean, string]> = [];
  checks.push([
    "mocked kickoff returns 200",
    res.status === 200,
    String(res.status),
  ]);

  // Wait a beat for the pipeline to write (route awaits inline
  // per the current implementation, so this is effectively
  // synchronous — but the wait guards against future async
  // refactoring).
  await new Promise((r) => setTimeout(r, 500));

  const { data: after } = await sb
    .from("ai_intake_events")
    .select("status, extraction, matches, proposal")
    .eq("id", seeded.id)
    .maybeSingle<{
      status: string;
      extraction: Record<string, unknown> | null;
      matches: Record<string, unknown> | null;
      proposal: Record<string, unknown> | null;
    }>();

  checks.push([
    "status flipped to 'review'",
    after?.status === "review",
    String(after?.status),
  ]);
  checks.push([
    "extraction populated (request_type=new_job)",
    typeof after?.extraction === "object" &&
      after?.extraction !== null &&
      (after.extraction as { request_type?: string }).request_type === "new_job",
    JSON.stringify(after?.extraction).slice(0, 120),
  ]);
  checks.push([
    "matches populated",
    typeof after?.matches === "object" && after?.matches !== null,
    typeof after?.matches,
  ]);
  checks.push([
    "proposal populated with primary array",
    typeof after?.proposal === "object" &&
      after?.proposal !== null &&
      Array.isArray((after.proposal as { primary?: unknown[] }).primary),
    JSON.stringify(after?.proposal).slice(0, 120),
  ]);
  checks.push([
    "proposal includes create_customer",
    Array.isArray((after?.proposal as { primary?: { type?: string }[] })?.primary) &&
      ((after?.proposal as { primary: { type?: string }[] }).primary.some(
        (a) => a.type === "create_customer",
      ) ?? false),
    JSON.stringify(
      (after?.proposal as { primary?: { type?: string }[] })?.primary?.map(
        (a) => a.type,
      ) ?? [],
    ),
  ]);

  let failed = 0;
  for (const [name, ok, actual] of checks) {
    if (ok) process.stdout.write(`[OK     ] ${name}\n`);
    else {
      process.stdout.write(`[FAIL   ] ${name}\n           ${actual}\n`);
      failed += 1;
    }
  }
  process.stdout.write(
    `\n${checks.length} check(s): ${checks.length - failed} OK, ${failed} FAIL\n`,
  );
  await cleanup();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  process.stderr.write(
    `intake pipeline smoke FAILED: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  await cleanup().catch(() => {});
  process.exit(1);
});
