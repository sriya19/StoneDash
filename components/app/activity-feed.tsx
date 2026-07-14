import { formatDistanceToNow } from "date-fns";
import {
  Bell,
  DollarSign,
  FileText,
  HardHat,
  Layers,
  Package,
  Sparkles,
  User,
  Wrench,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export type ActivityRow = {
  id: string;
  createdAt: string;
  actorName: string | null;
  entityType: string;
  action: string;
  metadata: Record<string, unknown>;
};

type Props = {
  items: ActivityRow[];
};

function iconFor(entityType: string) {
  switch (entityType) {
    case "order":
      return Wrench;
    case "customer":
      return User;
    case "attachment":
      return FileText;
    case "contractor":
      return HardHat;
    case "contractor_payment":
    case "contractor_allocation":
      return DollarSign;
    case "file_extraction":
      return Sparkles;
    case "reminder":
      return Bell;
    default:
      return Package;
  }
}

// Allocation-row audits are implementation detail of a payment — the
// payment row already tells the story ("$6,000 from Ameer — covers 2
// orders"). Hiding allocation rows keeps the feed from being three times
// noisier than a user's actual actions.
function shouldHide(entityType: string): boolean {
  // Same dedupe pattern as contractor_allocation: the parent event row
  // already tells the story, so per-assignment audits would triple the
  // feed noise without adding signal. The DB rows still exist for any
  // future "who was assigned and when" report — they're just hidden here.
  return (
    entityType === "contractor_allocation" ||
    entityType === "order_event_assignment"
  );
}

function moneyPhrase(meta: Record<string, unknown>): string {
  const raw = meta.amount;
  const n = typeof raw === "number" ? raw : raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return "a payment";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

function phraseFor(row: ActivityRow): string {
  const who = row.actorName ?? "Someone";
  const m = row.metadata;
  const orderNumber = typeof m.order_number === "string" ? m.order_number : null;
  const name = typeof m.name === "string" ? m.name : null;

  switch (`${row.entityType}:${row.action}`) {
    case "order:created":
      return `${who} created ${orderNumber ?? "an order"}`;
    case "order:stage_changed": {
      const from = typeof m.from === "string" ? m.from : "";
      const to = typeof m.to === "string" ? m.to : "";
      const note = typeof m.note === "string" && m.note.length > 0 ? m.note : null;
      const base = `${who} moved ${orderNumber ?? "an order"} from ${from} → ${to}`;
      return note ? `${base} — "${note}"` : base;
    }
    case "order:updated":
      return `${who} updated ${orderNumber ?? "an order"}`;
    case "order:deleted":
      return `${who} deleted ${orderNumber ?? "an order"}`;
    case "customer:created":
      return `${who} added customer ${name ?? ""}`.trim();
    case "customer:updated":
      return `${who} updated customer ${name ?? ""}`.trim();
    case "customer:deleted":
      return `${who} removed customer ${name ?? ""}`.trim();
    case "attachment:uploaded": {
      const filename = typeof m.original_name === "string" ? m.original_name : "a file";
      return `${who} uploaded ${filename}`;
    }
    case "attachment:deleted":
      return `${who} deleted an attachment`;
    case "contractor:created":
      return `${who} added contractor ${name ?? ""}`.trim();
    case "contractor:updated":
      return `${who} updated contractor ${name ?? ""}`.trim();
    case "contractor:deleted":
      return `${who} removed contractor ${name ?? ""}`.trim();
    case "contractor_payment:created":
      return `${who} recorded ${moneyPhrase(m)} from a contractor`;
    case "contractor_payment:updated":
      return `${who} edited a contractor payment (${moneyPhrase(m)})`;
    case "contractor_payment:deleted":
      return `${who} deleted a contractor payment (${moneyPhrase(m)})`;
    case "crew_member:created":
      return `${who} added ${name ?? "a crew member"} to the team`;
    case "crew_member:updated":
      return `${who} updated ${name ?? "a crew member"}`;
    case "crew_member:deleted":
      return `${who} removed ${name ?? "a crew member"}`;
    case "order_event:created": {
      const kind = typeof m.kind === "string" ? m.kind : "event";
      return `${who} scheduled ${kind}`;
    }
    case "order_event:rescheduled": {
      const kind = typeof m.kind === "string" ? m.kind : "event";
      return `${who} rescheduled ${kind}`;
    }
    case "order_event:status_changed": {
      const to = typeof m.to === "string" ? m.to : "";
      const kind = typeof m.kind === "string" ? m.kind : "event";
      const via = typeof m.via === "string" ? m.via : null;
      const action = `${kind} marked ${to.replace(/_/g, " ")}`;
      // Q1 lock: when the status update came via /j/[slug], actor_id is
      // NULL and we render WITHOUT a "Someone …" prefix, just the action
      // + suffix. The suffix is what disambiguates link-driven updates
      // from app-driven ones in the feed.
      if (via === "shared_link") {
        return `${action} (via shared link)`;
      }
      return `${who} ${action}`;
    }
    case "order_event:updated": {
      const kind = typeof m.kind === "string" ? m.kind : "event";
      return `${who} edited ${kind}`;
    }
    case "order_event:deleted": {
      const kind = typeof m.kind === "string" ? m.kind : "event";
      return `${who} deleted ${kind}`;
    }
    case "event_share_link:created":
      return `${who} generated a share link`;
    case "event_share_link:revoked":
      return `${who} revoked a share link`;
    case "event_share_link:deleted":
      return `${who} removed a share link`;
    case "file_extraction:created": {
      // Trigger fires with actor_id = auth.uid() on insert. When an
      // upload kicks off the extraction, the actor is the uploader —
      // read "Sriya's upload started an AI extraction on <file>".
      const fname = typeof m.file_name === "string" ? m.file_name : "a document";
      return `${who}'s upload started an AI extraction on ${fname}`;
    }
    case "file_extraction:status_changed": {
      const to = typeof m.to === "string" ? m.to : "";
      const doc = typeof m.document_type === "string" ? m.document_type : "document";
      if (to === "review") {
        return `AI extracted a ${doc} · needs review`;
      }
      if (to === "confirmed") {
        return `${who} confirmed a ${doc} extraction`;
      }
      if (to === "declined") {
        return `${who} declined a ${doc} extraction`;
      }
      if (to === "failed") {
        return `AI couldn't read a ${doc}`;
      }
      return `${who} moved a ${doc} extraction to ${to}`;
    }
    case "reminder:created": {
      const title = typeof m.title === "string" ? m.title : "a reminder";
      return `${who} scheduled reminder "${title}"`;
    }
    // Task 6C: AI intake pipeline. Sub-step 10's apply_intake RPC
    // writes exactly one activity_log row per confirm with
    // metadata.via='ai_intake' + metadata.summary = a human-
    // readable sentence per user Q11 refinement. Render the
    // summary directly rather than reconstructing from ids.
    case "ai_intake:created": {
      return `AI intake ready — screenshot dropped for review`;
    }
    case "ai_intake:status_changed": {
      const to = typeof m.to === "string" ? m.to : "";
      if (to === "review") return `AI intake ready · needs review`;
      if (to === "failed") return `AI couldn't read a screenshot`;
      return `${who} moved intake to ${to}`;
    }
    case "ai_intake:applied": {
      const summary = typeof m.summary === "string" ? m.summary : null;
      return summary ?? `${who} confirmed an AI intake`;
    }
    default:
      return `${who} ${row.action.replace(/_/g, " ")} ${row.entityType}`;
  }
}

function initials(name: string | null): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] ?? "").join("").toUpperCase() || "—";
}

type DisplayItem =
  | { kind: "single"; row: ActivityRow }
  | {
      kind: "group";
      key: string;
      actorName: string | null;
      latestAt: string;
      rows: ActivityRow[];
    };

// Collapse runs of 3+ consecutive rows by the same actor into a single
// "Sriya made N changes" line. Keeps the feed scannable on busy days
// where one person clears the queue. Runs of 1–2 stay individually
// rendered so we don't lose detail in the common case.
function collapseRuns(rows: ActivityRow[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  let i = 0;
  while (i < rows.length) {
    const start = i;
    const first = rows[start]!;
    const startActor = first.actorName;
    let j = i + 1;
    // Only collapse rows that share a non-null actor — anonymous rows
    // (shared-link updates) shouldn't fold together.
    while (
      j < rows.length &&
      rows[j]!.actorName !== null &&
      rows[j]!.actorName === startActor
    ) {
      j += 1;
    }
    const runLen = j - start;
    if (startActor !== null && runLen >= 3) {
      out.push({
        kind: "group",
        key: `g-${first.id}`,
        actorName: startActor,
        latestAt: first.createdAt,
        rows: rows.slice(start, j),
      });
    } else {
      for (let k = start; k < j; k += 1) {
        out.push({ kind: "single", row: rows[k]! });
      }
    }
    i = j;
  }
  return out;
}

export function ActivityFeed({ items }: Props) {
  const visibleItems = items.filter((item) => !shouldHide(item.entityType));
  const display = collapseRuns(visibleItems);
  return (
    <div className="flex h-full flex-col rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold">Recent activity</h2>
          <p className="text-xs text-muted-foreground">Latest 15 events.</p>
        </div>
      </div>
      <ol className="flex-1 divide-y">
        {display.length === 0 ? (
          <li className="px-5 py-10 text-center text-sm text-muted-foreground">
            Nothing yet. Create an order to get started.
          </li>
        ) : (
          display.map((item) =>
            item.kind === "single" ? (
              <SingleItem key={item.row.id} row={item.row} />
            ) : (
              <GroupItem key={item.key} group={item} />
            ),
          )
        )}
      </ol>
    </div>
  );
}

function SingleItem({ row }: { row: ActivityRow }) {
  const Icon = iconFor(row.entityType);
  return (
    <li className="flex items-start gap-3 px-5 py-3 text-sm">
      <Avatar className="mt-0.5 h-6 w-6">
        <AvatarFallback className="text-[10px]">
          {initials(row.actorName)}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 space-y-0.5">
        <p className="text-sm leading-snug">{phraseFor(row)}</p>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Icon className="h-3 w-3" />
          <time dateTime={row.createdAt}>
            {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })}
          </time>
        </p>
      </div>
    </li>
  );
}

function GroupItem({
  group,
}: {
  group: Extract<DisplayItem, { kind: "group" }>;
}) {
  return (
    <li className="px-5 py-3 text-sm">
      <div className="flex items-start gap-3">
        <Avatar className="mt-0.5 h-6 w-6">
          <AvatarFallback className="text-[10px]">
            {initials(group.actorName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 space-y-1.5">
          <p className="text-sm leading-snug">
            <span className="font-medium">{group.actorName}</span> made{" "}
            {group.rows.length} changes
          </p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Layers className="h-3 w-3" />
            <time dateTime={group.latestAt}>
              {formatDistanceToNow(new Date(group.latestAt), { addSuffix: true })}
            </time>
          </p>
          <ul className="space-y-0.5 border-l border-border/70 pl-3 text-[12px] text-muted-foreground">
            {group.rows.slice(0, 4).map((row) => (
              <li key={row.id} className="truncate leading-snug">
                {phraseFor({ ...row, actorName: "" }).replace(/^\s+/, "")}
              </li>
            ))}
            {group.rows.length > 4 ? (
              <li className="text-[11px] text-muted-foreground/80">
                + {group.rows.length - 4} more
              </li>
            ) : null}
          </ul>
        </div>
      </div>
    </li>
  );
}
