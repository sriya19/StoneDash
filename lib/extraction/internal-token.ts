// Signed internal token for the fire-and-forget kickoff pattern
// (PLAN Q1 lock). Server actions verify the caller's session and
// mint a short-lived HMAC over (fileId + timestamp). The
// /api/extract/[fileId] route verifies the HMAC before running the
// extraction — so a URL-guessing attacker can't kick extractions on
// files they don't own.
//
// The HMAC key is `EXTRACTION_INTERNAL_SECRET`. Falls back to a
// deterministic-per-install value derived from `SUPABASE_SERVICE_ROLE_KEY`
// so dev/CI works without an extra env; production should set the
// explicit env so a service-role key rotation doesn't invalidate
// in-flight tokens.

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

// Tokens expire fast — the fire-and-forget window is milliseconds,
// not minutes. 5 minutes is a generous ceiling that still shuts
// down replay attacks.
const TOKEN_TTL_SECONDS = 300;

function secret(): string {
  const explicit = process.env.EXTRACTION_INTERNAL_SECRET;
  if (explicit && explicit.length >= 16) return explicit;
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!fallback) {
    throw new Error(
      "Neither EXTRACTION_INTERNAL_SECRET nor SUPABASE_SERVICE_ROLE_KEY is set",
    );
  }
  return `extraction:${fallback}`;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

// Format: <base64url(fileId)>.<unixMs>.<hmacSig>
// base64url the fileId so the "." separator is unambiguous even if
// UUIDs ever gain new formats.
export function mintInternalToken(fileId: string): string {
  const now = Date.now();
  const encoded = Buffer.from(fileId, "utf8").toString("base64url");
  const payload = `${encoded}.${now}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyInternalToken(
  token: string | null,
  expectedFileId: string,
): { ok: true } | { ok: false; error: string } {
  if (!token) return { ok: false, error: "Missing internal token" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, error: "Malformed token" };
  const [encodedFileId, tsStr, sig] = parts as [string, string, string];

  const payload = `${encodedFileId}.${tsStr}`;
  const expectedSig = sign(payload);
  const sigBuf = Buffer.from(sig, "base64url");
  const expectedBuf = Buffer.from(expectedSig, "base64url");
  if (sigBuf.length !== expectedBuf.length) {
    return { ok: false, error: "Bad signature" };
  }
  if (!timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, error: "Bad signature" };
  }

  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return { ok: false, error: "Bad timestamp" };
  const age = (Date.now() - ts) / 1000;
  if (age > TOKEN_TTL_SECONDS) {
    return { ok: false, error: "Token expired" };
  }
  if (age < -60) {
    // Clock skew tolerance: allow up to 60s in the future.
    return { ok: false, error: "Token in the future" };
  }

  const decodedFileId = Buffer.from(encodedFileId, "base64url").toString("utf8");
  if (decodedFileId !== expectedFileId) {
    return { ok: false, error: "Token file_id mismatch" };
  }

  return { ok: true };
}
