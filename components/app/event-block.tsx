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
  const palette = EVENT_COLOR_CLASSES[colorKey];
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
          // pl-2 clears the 3px stripe below; everything else is unchanged.
          "relative flex items-center gap-1.5 overflow-hidden rounded-md border py-0.5 pl-2 pr-5 text-left text-[10px] leading-tight",
          palette.pillBg,
          terminal && "opacity-60",
        )}
        title={tooltip}
      >
        <Stripe className={palette.stripe} width="w-[3px]" />
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
        // pl-2.5 clears the 4px stripe below. That padding bump is the one
        // dimension Task 8 changes, and it is forced by the stripe rather
        // than a layout opinion.
        "relative h-full overflow-hidden rounded-md border py-1 pl-2.5 pr-1.5 text-left",
        palette.bg,
        terminal && "opacity-60",
      )}
      title={tooltip}
    >
      <Stripe className={palette.stripe} width="w-1" />
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

// Left-edge colored stripe (Task 8 Fix 2). The event's color at full
// strength against the block's ~15%/25% tint of the same hue — the tint
// tells you which kind at a glance across a whole week, the stripe gives
// the eye a hard edge to land on. Purely decorative: the color is never
// the only carrier of meaning (the kind is also written in the list view
// and the dialog), so it takes aria-hidden and no label.
//
// Sits inside the parent's `overflow-hidden rounded-md`, so it inherits
// the rounded corners rather than needing its own.
function Stripe({ className, width }: { className: string; width: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("absolute inset-y-0 left-0", width, className)}
    />
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
