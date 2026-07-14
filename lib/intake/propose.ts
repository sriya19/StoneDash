// Step C — deterministic proposal dispatcher.
//
// Pure function: (extraction, matches, orgTimezone) → { primary,
// alternates }. No DB access, no LLM. The same shape is consumed
// by the review sheet's preview AND the apply RPC's validation
// whitelist so client + server always agree on "which action did
// the user check".
//
// Seven request_type × match combinations per brief:
//   new_job    + no customer match → create customer + create order
//   new_job    + customer match    → create order for matched customer
//   repair     + order match       → repair event + append note
//   repair     + no order match    → create customer (if none) +
//                                    create order (stage=quote,
//                                    notes=request)
//   scheduling + order match       → event (kind picked from text)
//                                    + append note
//   scheduling + no order match    → full chain: customer + order + event
//   payment                        → no_op (open contractor page manually)
//   question / unclear             → no_op

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
      stage: "quote" | "measurement";
      customerRef: { kind: "matched"; id: string } | { kind: "new"; key: string };
      defaultChecked: boolean;
      description: string;
    }
  | {
      key: string;
      type: "create_event";
      kind: "measurement" | "install" | "repair" | "task";
      startsAtIso: string; // yyyy-MM-ddTHH:mm:ss local; the apply step
                            // re-parses via parseLocalDateTime with the
                            // org tz — same shape the manual dialog
                            // sends.
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

// Stable action keys. Client checks them, apply_intake whitelist
// intersects them. Same pattern as Task 5's proposed-actions.ts.
const KEYS = {
  createCustomer: "customer:new",
  createOrder: "order:new",
  createEvent: "event:new",
  appendNote: "note:append",
  noop: "noop",
} as const;

// Default event time = 09:00 in the org tz. Review sheet lets the
// user override; this is just the pre-fill.
const DEFAULT_HOUR = 9;
const DEFAULT_MINUTE = 0;

const DEFAULT_DURATION: Record<
  "measurement" | "install" | "repair" | "task",
  number
> = {
  measurement: 60,
  install: 180,
  repair: 60,
  task: 60,
};

function pickEventKind(
  extraction: IntakeExtraction,
): "measurement" | "install" | "repair" | "task" {
  if (extraction.request_type === "repair") return "repair";
  const hay = [
    extraction.requested_action ?? "",
    extraction.project_details ?? "",
    extraction.raw_transcript ?? "",
  ]
    .join(" ")
    .toLowerCase();
  if (/\b(meas(ure|ur\w*)?|template|templating)\b/.test(hay)) return "measurement";
  if (/\b(install(ation|ing)?)\b/.test(hay)) return "install";
  return "task";
}

function firstResolvedDate(extraction: IntakeExtraction): string | null {
  for (const d of extraction.requested_dates) {
    if (d.iso) return d.iso;
  }
  return null;
}

function isoStartsAt(dateIso: string): string {
  const hh = String(DEFAULT_HOUR).padStart(2, "0");
  const mm = String(DEFAULT_MINUTE).padStart(2, "0");
  return `${dateIso}T${hh}:${mm}:00`;
}

function firstProjectName(extraction: IntakeExtraction): string {
  const cand =
    extraction.project_details ??
    extraction.requested_action ??
    "New request from screenshot";
  return cand.trim().slice(0, 120);
}

function summarizeRequest(extraction: IntakeExtraction): string {
  return extraction.requested_action?.trim() || "Intake request";
}

function humanDateShort(iso: string): string {
  const d = new Date(`${iso}T09:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

type CustomerRef = { kind: "matched"; id: string } | { kind: "new"; key: string };
type OrderRef = { kind: "matched"; id: string } | { kind: "new"; key: string };

export function propose(
  extraction: IntakeExtraction,
  matches: IntakeMatches,
  orgTimezone: string,
): Proposal {
  void orgTimezone; // reserved for future timezone-sensitive branches

  const primary: ProposedIntakeAction[] = [];
  const customerMatchId = matches.matched_customer.id;
  const orderMatchId = matches.matched_order.id;

  // Payment — never auto-write.
  if (extraction.request_type === "payment") {
    primary.push({
      key: KEYS.noop,
      type: "no_op",
      description:
        "Looks like a payment discussion — no automatic actions proposed. Review manually.",
      defaultChecked: false,
    });
    return { primary, alternates: [] };
  }

  // Question / unclear — no writes; just surface.
  if (
    extraction.request_type === "question" ||
    extraction.request_type === "unclear"
  ) {
    primary.push({
      key: KEYS.noop,
      type: "no_op",
      description:
        extraction.request_type === "question"
          ? "Customer is asking a question — no automatic actions proposed. Reply manually."
          : "The message is unclear — no automatic actions proposed. Review manually.",
      defaultChecked: false,
    });
    return { primary, alternates: [] };
  }

  // Everything below (new_job / repair / scheduling) may need to
  // create a customer first.
  const needsCustomer = customerMatchId === null && !!extraction.contact_name;
  const customerRef: CustomerRef = customerMatchId
    ? { kind: "matched", id: customerMatchId }
    : { kind: "new", key: KEYS.createCustomer };

  if (needsCustomer) {
    primary.push({
      key: KEYS.createCustomer,
      type: "create_customer",
      name: extraction.contact_name!,
      phone: extraction.phone,
      email: extraction.email,
      address: extraction.address,
      defaultChecked: true,
      description: `Create customer ${extraction.contact_name}${
        extraction.phone ? ` · ${extraction.phone}` : ""
      }`,
    });
  }

  // ---- new_job ----
  if (extraction.request_type === "new_job") {
    primary.push({
      key: KEYS.createOrder,
      type: "create_order",
      projectName: firstProjectName(extraction),
      stoneType: null,
      notes: summarizeRequest(extraction),
      stage: "quote",
      customerRef,
      defaultChecked: true,
      description: `Create order (${firstProjectName(extraction)}) as quote${
        customerMatchId ? "" : " for new customer"
      }`,
    });
    return { primary, alternates: [] };
  }

  // ---- scheduling ----
  if (extraction.request_type === "scheduling") {
    const orderRef: OrderRef = orderMatchId
      ? { kind: "matched", id: orderMatchId }
      : { kind: "new", key: KEYS.createOrder };

    if (!orderMatchId) {
      primary.push({
        key: KEYS.createOrder,
        type: "create_order",
        projectName: firstProjectName(extraction),
        stoneType: null,
        notes: summarizeRequest(extraction),
        stage: "measurement",
        customerRef,
        defaultChecked: true,
        description: `Create order (${firstProjectName(extraction)}) to attach the scheduled event`,
      });
    }

    const eventDateIso = firstResolvedDate(extraction);
    if (eventDateIso) {
      const kind = pickEventKind(extraction);
      primary.push({
        key: KEYS.createEvent,
        type: "create_event",
        kind,
        startsAtIso: isoStartsAt(eventDateIso),
        durationMin: DEFAULT_DURATION[kind],
        locationText: extraction.address,
        notes: summarizeRequest(extraction),
        orderRef,
        defaultChecked: true,
        description: `Create event: ${kind[0]?.toUpperCase()}${kind.slice(
          1,
        )} · ${humanDateShort(eventDateIso)} · ${extraction.address ?? "no location"}`,
      });
    }

    if (orderMatchId) {
      primary.push({
        key: KEYS.appendNote,
        type: "append_note",
        orderRef,
        body: `Scheduling request from screenshot: ${summarizeRequest(extraction)}`,
        defaultChecked: true,
        description: `Append note to matched order`,
      });
    }

    return { primary, alternates: [] };
  }

  // ---- repair ----
  if (extraction.request_type === "repair") {
    if (orderMatchId) {
      const orderRef: OrderRef = { kind: "matched", id: orderMatchId };

      const eventDateIso = firstResolvedDate(extraction);
      const kind = "repair" as const;
      if (eventDateIso) {
        primary.push({
          key: KEYS.createEvent,
          type: "create_event",
          kind,
          startsAtIso: isoStartsAt(eventDateIso),
          durationMin: DEFAULT_DURATION[kind],
          locationText: extraction.address,
          notes: summarizeRequest(extraction),
          orderRef,
          defaultChecked: true,
          description: `Create repair event · ${humanDateShort(eventDateIso)}`,
        });
      }

      primary.push({
        key: KEYS.appendNote,
        type: "append_note",
        orderRef,
        body: `Repair request from screenshot: ${summarizeRequest(extraction)}`,
        defaultChecked: true,
        description: `Append repair note to matched order`,
      });
      return { primary, alternates: [] };
    }

    // No order match — treat as a new quote-stage order.
    primary.push({
      key: KEYS.createOrder,
      type: "create_order",
      projectName: firstProjectName(extraction),
      stoneType: null,
      notes: `Repair request: ${summarizeRequest(extraction)}`,
      stage: "quote",
      customerRef,
      defaultChecked: true,
      description: `Create order for repair request (as quote)`,
    });
    return { primary, alternates: [] };
  }

  // Fallthrough (shouldn't happen given the enum) — no-op.
  primary.push({
    key: KEYS.noop,
    type: "no_op",
    description: "No automatic actions proposed. Review manually.",
    defaultChecked: false,
  });
  return { primary, alternates: [] };
}

// Whitelist consumed by apply_intake to reject rogue action keys.
export const APPLY_ACTION_KEYS: readonly string[] = Object.values(KEYS);
