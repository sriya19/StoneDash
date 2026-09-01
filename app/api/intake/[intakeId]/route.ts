// POST /api/intake/[intakeId]
//
// Internal fire-and-forget endpoint that runs the intake pipeline
// and writes the result back to `ai_intake_events`. Called by the
// `kickOffIntake` server action with an HMAC-signed
// `Authorization: Internal <token>` header (reusing the Task 5
// mint/verify functions — same secret, same TTL).
//
// Flow:
//   1. Verify HMAC token from Authorization header.
//   2. Load the intake row via service-role (no user session on
//      the internal call — the HMAC IS the auth).
//   3. Load the org's timezone (needed for Step A date resolution
//      and Step B/C context).
//   4. Optional mock/fixture short-circuit for mock mode.
//   5. Download screenshot bytes from Supabase Storage.
//   6. Step A — GPT-4o vision (or mock fixture).
//   7. Step B — pg_trgm fuzzy match (always runs, even in mock).
//   8. Step C — deterministic proposal (always runs).
//   9. Write extraction + matches + proposal + cost_cents, flip
//      status to 'review'.
//   10. Any thrown error → status='failed' + error_message.

import { type NextRequest, NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyInternalToken } from "@/lib/extraction/internal-token";
import { runStepA } from "@/lib/intake/pipeline";
import { isMockKey, mockIntakeExtraction } from "@/lib/intake/mock";
import type { IntakeExtraction } from "@/lib/intake/types";
import { isMockAi } from "@/lib/env/mock-guard";

// Supported mime types for screenshots. Anything else → 'failed'.
const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

type IntakeRow = {
  id: string;
  org_id: string;
  storage_path: string;
  status: string;
};

type OrgRow = { id: string; timezone: string };

function isMockMode(request: NextRequest): boolean {
  const url = new URL(request.url);
  if (url.searchParams.get("mode") === "mock") return true;
  if (url.searchParams.get("fixture")) return true;
  if (isMockAi()) return true;
  return false;
}

async function writeFailed(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  intakeId: string,
  errorMessage: string,
): Promise<void> {
  await admin
    .from("ai_intake_events")
    .update({
      status: "failed",
      error_message: errorMessage.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", intakeId);
}

export async function POST(
  request: NextRequest,
  { params }: { params: { intakeId: string } },
) {
  const intakeId = params.intakeId;
  if (!intakeId) {
    return NextResponse.json(
      { ok: false, error: "Missing intakeId" },
      { status: 400 },
    );
  }

  // 1. HMAC.
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Internal ")
    ? authHeader.slice("Internal ".length)
    : null;
  const verify = verifyInternalToken(token, intakeId);
  if (!verify.ok) {
    return NextResponse.json({ ok: false, error: verify.error }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();

  // 2. Load intake + org.
  const { data: intake, error: intakeErr } = await admin
    .from("ai_intake_events")
    .select("id, org_id, storage_path, status")
    .eq("id", intakeId)
    .maybeSingle<IntakeRow>();
  if (intakeErr || !intake) {
    return NextResponse.json(
      { ok: false, error: intakeErr?.message ?? "Intake not found" },
      { status: 404 },
    );
  }

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, timezone")
    .eq("id", intake.org_id)
    .maybeSingle<OrgRow>();
  if (orgErr || !org) {
    await writeFailed(admin, intakeId, "org not found");
    return NextResponse.json(
      { ok: false, error: "org not found" },
      { status: 500 },
    );
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const url = new URL(request.url);
  const fixtureParam = url.searchParams.get("fixture");
  const mocked = isMockMode(request);

  try {
    // 3-6. Extraction (mock short-circuit OR real Step A).
    let extraction: IntakeExtraction;
    let costCents = 0;
    let rawResponse: unknown = null;

    if (mocked) {
      const key = isMockKey(fixtureParam) ? fixtureParam : "whatsapp_new_job";
      // Mock-mode-only persona override, so the intake smoke can run a
      // unique identity per run and never collide with real customer
      // records created by earlier /intake confirmations.
      const personaName = url.searchParams.get("persona_name");
      const personaPhone = url.searchParams.get("persona_phone");
      extraction = mockIntakeExtraction(
        key,
        personaName || personaPhone
          ? {
              contact_name: personaName ?? undefined,
              phone: personaPhone ?? undefined,
            }
          : undefined,
      );
      rawResponse = { mocked: true, fixture: key };
    } else {
      // Download screenshot bytes.
      const { data: blob, error: dlErr } = await admin.storage
        .from("order-files")
        .download(intake.storage_path);
      if (dlErr || !blob) {
        await writeFailed(admin, intakeId, dlErr?.message ?? "download failed");
        return NextResponse.json(
          { ok: false, error: dlErr?.message ?? "download failed" },
          { status: 500 },
        );
      }
      const mime = blob.type || "image/png";
      if (!IMAGE_MIMES.has(mime)) {
        await writeFailed(admin, intakeId, `unsupported mime: ${mime}`);
        return NextResponse.json(
          { ok: false, error: `unsupported mime: ${mime}` },
          { status: 415 },
        );
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const stepA = await runStepA(bytes, mime, {
        todayIso,
        orgTimezone: org.timezone,
      });
      extraction = stepA.extraction;
      costCents = stepA.costCents;
      rawResponse = { usage: stepA.raw.usage };
    }

    // 7. Step B — matching. Lazy-imported so the route file doesn't
    // load the module unless the pipeline actually runs (keeps
    // startup fast + avoids issues if the module has heavy deps).
    const { runMatches } = await import("@/lib/intake/match");
    const matches = await runMatches(admin, intake.org_id, extraction);

    // 8. Step C — proposal. Pure function; deterministic.
    const { propose } = await import("@/lib/intake/propose");
    const proposal = propose(extraction, matches, org.timezone);

    // 9. Write.
    const { error: writeErr } = await admin
      .from("ai_intake_events")
      .update({
        status: "review",
        extraction,
        matches,
        proposal,
        cost_cents: costCents,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", intakeId);
    if (writeErr) {
      await writeFailed(admin, intakeId, writeErr.message);
      return NextResponse.json(
        { ok: false, error: writeErr.message },
        { status: 500 },
      );
    }

    void rawResponse; // recorded via the pipeline usage above; sub-step 6 seed can carry {mocked, fixture}
    return NextResponse.json({ ok: true, mocked });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeFailed(admin, intakeId, msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
