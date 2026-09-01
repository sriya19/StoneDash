// Canned extractions for `MOCK_AI=1` mode + the smoke
// test path. Shape-compatible with what the real OpenAI pipeline
// returns so the downstream code (review sheet, apply.ts) doesn't
// need a special-case path for mocked rows.
//
// The mock always classifies as `template` — realistic enough to
// exercise the "populate empty order fields" downstream flow which
// is where most Task 5 UX complexity lives.

import type { ExtractionResult } from "./types";

export function mockExtraction(): ExtractionResult {
  return {
    document_type: "template",
    confidence: "medium",
    fields: {
      customer_name: "Mock Customer",
      project_address: "123 Demo Lane, Springfield, VA",
      measurement_date: "2026-06-15",
      total_sqft: 42.5,
      sink_cutouts: 1,
      cooktop_cutouts: 1,
      edge_profile: "Eased",
      stone_type: "Calacatta Gold quartz",
      notes: "Mocked extraction — MOCK_AI is enabled.",
    },
    raw: {
      mocked: true,
      note: "This response was generated without an OpenAI call.",
    },
    cost_cents: 0,
  };
}
