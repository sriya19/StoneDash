// Step B shim. Real implementation lands in sub-step 6.
//
// Returns the shape the route + client expect so the pipeline can
// be wired end-to-end during sub-step 5 without waiting for the
// pg_trgm queries + unit tests to land.

import "server-only";

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

export async function runMatches(
  supabase: SupabaseClient,
  orgId: string,
  extraction: IntakeExtraction,
): Promise<IntakeMatches> {
  // Sub-step 6 fills this out with real pg_trgm queries + phone
  // exact + email exact + tier logic. For now, everything reports
  // "none" so the proposal step still runs and the route can be
  // exercised end-to-end.
  void supabase;
  void orgId;
  void extraction;
  return {
    matched_customer: EMPTY,
    matched_order: EMPTY,
    matched_contractor: EMPTY,
  };
}

const EMPTY: IntakeMatchedEntity = {
  id: null,
  confidence: 0,
  tier: "none",
  method: null,
};
