// Step C shim. Real dispatcher lands in sub-step 7.
//
// Returns the shape the client review sheet expects. Pure function,
// no server-only guard (kept client-safe so the review sheet can
// re-run it on user edits without a round-trip).

import type { IntakeExtraction } from "./types";
import type { IntakeMatches } from "./match";

export type ProposedIntakeAction =
  | {
      key: string;
      type: "create_customer";
      name: string;
      phone: string | null;
      email: string | null;
      address: string | null;
      defaultChecked: boolean;
      description: string;
    }
  | {
      key: string;
      type: "create_order";
      projectName: string;
      stoneType: string | null;
      notes: string | null;
      // When create_customer is also proposed, resolve at apply time
      // by referencing this key.
      customerRef: { kind: "matched"; id: string } | { kind: "new"; key: string };
      defaultChecked: boolean;
      description: string;
    }
  | {
      key: string;
      type: "create_event";
      kind: string;
      startsAtIso: string; // ISO 8601 including time in org tz applied
      durationMin: number;
      locationText: string | null;
      notes: string | null;
      orderRef: { kind: "matched"; id: string } | { kind: "new"; key: string };
      defaultChecked: boolean;
      description: string;
    }
  | {
      key: string;
      type: "append_note";
      orderRef: { kind: "matched"; id: string } | { kind: "new"; key: string };
      body: string;
      defaultChecked: boolean;
      description: string;
    }
  | {
      key: string;
      type: "no_op";
      description: string;
      defaultChecked: false;
    };

export type Proposal = {
  primary: ProposedIntakeAction[];
  alternates: ProposedIntakeAction[][];
};

export function propose(
  extraction: IntakeExtraction,
  matches: IntakeMatches,
  orgTimezone: string,
): Proposal {
  // Sub-step 7 fills in the seven-way dispatcher. For now every
  // intake surfaces as a single no_op action so the review sheet
  // has something to render + the pipeline is exercisable end-to-end.
  void matches;
  void orgTimezone;
  const primary: ProposedIntakeAction[] = [
    {
      key: "noop:review",
      type: "no_op",
      description:
        extraction.requested_action ??
        "Sub-step 7 will fill in a proposed action here.",
      defaultChecked: false,
    },
  ];
  return { primary, alternates: [] };
}
