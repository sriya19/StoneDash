// Step B — fuzzy match an intake extraction against the org's
// existing customers / orders / contractors. Runs against the
// pg_trgm indexes shipped in migration 0020 for O(1)-ish lookups.
//
// Confidence tiers per PLAN Q10:
//   high   > 0.85
//   medium 0.5–0.85
//   none   < 0.5
//
// Best-of-methods aggregation: for a customer we try phone exact
// (highest confidence), email exact, then trigram similarity on
// the name. First method that lands a hit wins.
//
// No "server-only" guard here — the module takes a SupabaseClient
// from the caller (doesn't create one), so it's safe to import
// from either the route handler OR a Node test script. Both
// callers are server-side; the "server-only" package would fight
// tsx unnecessarily.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { IntakeExtraction } from "./types";

export type IntakeMatchTier = "high" | "medium" | "none";

export type IntakeMatchedEntity = {
  id: string | null;
  confidence: number; // 0..1
  tier: IntakeMatchTier;
  method: string | null;
};

export type IntakeMatches = {
  matched_customer: IntakeMatchedEntity;
  matched_order: IntakeMatchedEntity;
  matched_contractor: IntakeMatchedEntity;
};

const EMPTY: IntakeMatchedEntity = {
  id: null,
  confidence: 0,
  tier: "none",
  method: null,
};

// Phone normalization: digits-only. Matches the digits_only()
// helper in migration 0019 so a "+1 (555) 411-8823" screenshot
// and a "5554118823" DB row line up.
function digitsOnly(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

export function tierFor(score: number): IntakeMatchTier {
  if (score >= 0.85) return "high";
  if (score >= 0.5) return "medium";
  return "none";
}

// pg_trgm similarity threshold at the SQL level. Default `%`
// returns rows > 0.3; we lift to 0.5 (medium floor) so we don't
// waste bandwidth on rows that would drop to "none" in JS anyway.
const TRIGRAM_MIN = 0.5;

// ---------------------------------------------------------------------------
// Customer matching
// ---------------------------------------------------------------------------

type CustomerRow = { id: string; name: string; phone: string | null; email: string | null };

async function matchCustomer(
  supabase: SupabaseClient,
  orgId: string,
  extraction: IntakeExtraction,
): Promise<IntakeMatchedEntity> {
  // Phone exact — 1.0 confidence.
  if (extraction.phone) {
    const digits = digitsOnly(extraction.phone);
    if (digits.length >= 7) {
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone, email")
        .eq("org_id", orgId)
        .not("phone", "is", null)
        .returns<CustomerRow[]>();
      const rows = data ?? [];
      const hit = rows.find((r) => r.phone && digitsOnly(r.phone) === digits);
      if (hit) {
        return { id: hit.id, confidence: 1, tier: "high", method: "phone_exact" };
      }
    }
  }

  // Email exact — 1.0 confidence.
  if (extraction.email) {
    const norm = extraction.email.trim().toLowerCase();
    if (norm.length > 0) {
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone, email")
        .eq("org_id", orgId)
        .ilike("email", norm)
        .limit(1)
        .maybeSingle<CustomerRow>();
      if (data) {
        return { id: data.id, confidence: 1, tier: "high", method: "email_exact" };
      }
    }
  }

  // Name trigram — uses the customers_name_trgm_idx from 0020.
  if (extraction.contact_name) {
    const name = extraction.contact_name.trim().toLowerCase();
    if (name.length >= 3) {
      const { data } = await supabase.rpc("intake_match_customer_by_name", {
        p_org_id: orgId,
        p_name: name,
        p_min_similarity: TRIGRAM_MIN,
      });
      const row = Array.isArray(data)
        ? (data[0] as { id: string; similarity: number } | undefined)
        : null;
      if (row) {
        return {
          id: row.id,
          confidence: row.similarity,
          tier: tierFor(row.similarity),
          method: "name_trigram",
        };
      }
    }
  }

  return EMPTY;
}

// ---------------------------------------------------------------------------
// Order matching
// ---------------------------------------------------------------------------
//
// Two axes: trigram-similar project_name, and "linked to a
// customer we already matched". If both fire, prefer the one whose
// customer is our matched customer with a lifted similarity.

async function matchOrder(
  supabase: SupabaseClient,
  orgId: string,
  extraction: IntakeExtraction,
  matchedCustomerId: string | null,
): Promise<IntakeMatchedEntity> {
  const nameCandidates: string[] = [];
  if (extraction.project_details) nameCandidates.push(extraction.project_details);
  if (extraction.requested_action) nameCandidates.push(extraction.requested_action);

  let bestByName: { id: string; similarity: number } | null = null;
  for (const cand of nameCandidates) {
    const norm = cand.trim().toLowerCase();
    if (norm.length < 4) continue;
    const { data } = await supabase.rpc("intake_match_order_by_project", {
      p_org_id: orgId,
      p_project: norm,
      p_min_similarity: TRIGRAM_MIN,
    });
    const row = Array.isArray(data)
      ? (data[0] as { id: string; similarity: number } | undefined)
      : null;
    if (row && (!bestByName || row.similarity > bestByName.similarity)) {
      bestByName = row;
    }
  }

  if (matchedCustomerId) {
    const { data } = await supabase
      .from("orders")
      .select("id, project_name, stage")
      .eq("org_id", orgId)
      .eq("customer_id", matchedCustomerId)
      .not("stage", "in", "(paid,cancelled)")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; project_name: string | null; stage: string }>();
    if (data) {
      const sim =
        bestByName && bestByName.id === data.id
          ? Math.max(bestByName.similarity, 0.85)
          : 0.8;
      return {
        id: data.id,
        confidence: sim,
        tier: tierFor(sim),
        method:
          bestByName && bestByName.id === data.id
            ? "customer_link+project_trigram"
            : "customer_link",
      };
    }
  }

  if (bestByName) {
    return {
      id: bestByName.id,
      confidence: bestByName.similarity,
      tier: tierFor(bestByName.similarity),
      method: "project_trigram",
    };
  }

  return EMPTY;
}

// ---------------------------------------------------------------------------
// Contractor matching
// ---------------------------------------------------------------------------

async function matchContractor(
  supabase: SupabaseClient,
  orgId: string,
  extraction: IntakeExtraction,
): Promise<IntakeMatchedEntity> {
  const cand = extraction.project_details ?? extraction.contact_name;
  if (!cand) return EMPTY;
  const norm = cand.trim().toLowerCase();
  if (norm.length < 4) return EMPTY;

  const { data } = await supabase.rpc("intake_match_contractor_by_name", {
    p_org_id: orgId,
    p_name: norm,
    p_min_similarity: TRIGRAM_MIN,
  });
  const row = Array.isArray(data)
    ? (data[0] as { id: string; similarity: number } | undefined)
    : null;
  if (!row) return EMPTY;

  return {
    id: row.id,
    confidence: row.similarity,
    tier: tierFor(row.similarity),
    method: "name_trigram",
  };
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function runMatches(
  supabase: SupabaseClient,
  orgId: string,
  extraction: IntakeExtraction,
): Promise<IntakeMatches> {
  const matched_customer = await matchCustomer(supabase, orgId, extraction);
  const matched_order = await matchOrder(
    supabase,
    orgId,
    extraction,
    matched_customer.id,
  );
  const matched_contractor = await matchContractor(supabase, orgId, extraction);

  return { matched_customer, matched_order, matched_contractor };
}
