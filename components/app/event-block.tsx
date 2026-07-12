"use client";

import Link from "next/link";
import { Share2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatInTimeZone } from "@/lib/tz";
import type { CalendarEvent } from "@/lib/queries/events";
import { EVENT_COLOR_CLASSES, getEventColor } from "@/lib/events/color";

// Cancelled / no_show / complete render with reduced visual weight so the
// active week is what the eye lands on first.
function isTerminal(status: string): boolean {
  return status === "cancelled" || status === "no_show" || status === "complete";
}

type Props = {
  event: CalendarEvent;
  timeZone: string;
  size?: "sm" | "md";
  // "block" = the normal column-positioned card with crew + customer + time
  //           (week and day views, hour grid).
  // "pill"  = one-line horizontal strip for the all-day row above the hour
  //           grid. No customer line, no crew avatars, no time (it's all-day).
  variant?: "block" | "pill";
  // Optional: render a small Share2 icon in the top-right corner that links
  // to ?send=<eventId>. The link stops propagation so the surrounding event
  // click (which opens the edit dialog) doesn't also fire. Carries the
  // standard data-testid for the DOM smoke gate.
  sendHref?: string;
};

export function EventBlock({
  event,
  timeZone,
  size = "sm",
  variant = "block",
  sendHref,
}: Props) {
  const colorKey = getEventColor(event);
  const kindClass = EVENT_COLOR_CLASSES[colorKey].bg;
  const terminal = isTerminal(event.status);

  // Standalone events have no order_number / project_name — their title
  // does both jobs. Order-tied events keep the original mono-prefix +
  // project-name layout.
  const headerLabel = event.isStandalone
    ? event.title ?? "Untitled"
    : event.orderNumber ?? "—";
  const bodyLabel = event.isStandalone
    ? null
    : event.projectName ?? "Untitled";
  const tooltip = event.isStandalone
    ? event.title ?? "Untitled"
    : `${event.orderNumber ?? "—"} — ${event.projectName ?? "Untitled"}`;

  if (variant === "pill") {
    return (
      <div
        className={cn(
          "relative flex items-center gap-1.5 overflow-hidden rounded-md border px-1.5 py-0.5 pr-5 text-left text-[10px] leading-tight",
          kindClass,
          terminal && "opacity-60",
        )}
        title={tooltip}
      >
        <span
          className={cn(
            "shrink-0",
            event.isStandalone ? "font-medium" : "font-mono font-medium",
            terminal && "line-through",
          )}
        >
          {headerLabel}
        </span>
        {bodyLabel ? (
          <span className="truncate font-medium opacity-90">— {bodyLabel}</span>
        ) : null}
        {sendHref ? <SendCorner href={sendHref} /> : null}
      </div>
    );
  }

  // All-day events in the (rarely-shown) hour grid would render "All day"
  // — but they normally render in the pill variant above, so this only
  // fires if a caller passes an all-day event as variant="block".
  const startLabel = event.isAllDay
    ? "All day"
    : formatInTimeZone(event.startsAt, timeZone, "h:mm a");

  return (
    <div
      className={cn(
        "relative h-full overflow-hidden rounded-md border px-1.5 py-1 text-left",
        kindClass,
        terminal && "opacity-60",
      )}
      title={tooltip}
    >
      {sendHref ? <SendCorner href={sendHref} /> : null}
      <div className="flex items-center justify-between gap-1 pr-5 text-[10px] leading-tight">
        <span
          className={cn(
            event.isStandalone ? "truncate font-medium" : "font-mono font-medium",
            terminal && "line-through",
          )}
        >
          {headerLabel}
        </span>
        <span className="opacity-80">{startLabel}</span>
      </div>
      {bodyLabel ? (
        <p
          className={cn(
            "truncate font-medium leading-tight",
            size === "md" ? "text-sm" : "text-xs",
          )}
        >
          {bodyLabel}
        </p>
      ) : null}
      {event.customerName ? (
        <p className="truncate text-[11px] leading-tight opacity-80">
          {event.customerName}
        </p>
      ) : null}
      {event.crew.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-0.5">
          {event.crew.slice(0, 3).map((c) => (
            <span
              key={c.id}
              className="rounded bg-background/60 px-1 text-[9px] font-medium"
              title={c.role ? `${c.name} · ${c.role}` : c.name}
            >
              {initials(c.name)}
            </span>
          ))}
          {event.crew.length > 3 ? (
            <span className="text-[9px] opacity-70">+{event.crew.length - 3}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

// Absolute-positioned Send-to-crew icon in the top-right corner of an
// event block / pill. The link stops propagation so the outer event's
// click handler (which opens the edit dialog) doesn't also fire.
function SendCorner({ href }: { href: string }) {
  return (
    <Link
      href={href}
      data-testid="send-to-crew"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      title="Send to crew"
      aria-label="Send to crew"
      className="absolute right-0.5 top-0.5 z-10 inline-flex items-center justify-center rounded p-0.5 opacity-70 transition hover:bg-background/60 hover:opacity-100"
    >
      <Share2 className="h-3 w-3" />
    </Link>
  );
}
