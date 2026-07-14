// Plain-English summarizer for an intake extraction. Feeds the
// "What I understood" panel in <IntakeReviewSheet>. Pure function.
//
// Kept intentionally short — the reviewer will read the full
// raw_transcript below if they want depth. This is a headline.

import type { IntakeExtraction } from "./types";

export function describeIntake(ex: IntakeExtraction): string {
  const parts: string[] = [];
  const name = ex.contact_name?.trim();
  const action = ex.requested_action?.trim();

  if (name && action) {
    parts.push(`${name} — ${lowerCaseFirst(action)}`);
  } else if (action) {
    parts.push(capitalizeFirst(action));
  } else if (name) {
    parts.push(`Message from ${name}.`);
  } else {
    parts.push("Unlabeled intake.");
  }

  if (ex.address) {
    parts.push(`Address: ${ex.address}.`);
  }

  const firstDate = ex.requested_dates.find((d) => d.raw);
  if (firstDate) {
    if (firstDate.iso) {
      parts.push(
        `Mentions ${firstDate.raw} → ${formatDateShort(firstDate.iso)}.`,
      );
    } else {
      parts.push(`Mentions ${firstDate.raw}.`);
    }
  }

  const urgency = ex.urgency;
  if (urgency === "asap") parts.push("Urgency: ASAP.");
  else if (urgency === "soon") parts.push("Urgency: soon.");

  return parts.join(" ");
}

function lowerCaseFirst(s: string): string {
  return s.length > 0 ? s[0]!.toLowerCase() + s.slice(1) : s;
}
function capitalizeFirst(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}
function formatDateShort(iso: string): string {
  const d = new Date(`${iso}T09:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
