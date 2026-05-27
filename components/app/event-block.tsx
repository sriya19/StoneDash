import { cn } from "@/lib/utils";
import { formatInTimeZone } from "@/lib/tz";
import type { CalendarEvent } from "@/lib/queries/events";

// Color tokens per event kind. Same palette used by crew-detail-sheet's
// history list so the two surfaces stay in lockstep.
export const KIND_BG: Record<string, string> = {
  measurement: "bg-purple-100/80 border-purple-400/60 text-purple-950 dark:bg-purple-900/40 dark:border-purple-500/60 dark:text-purple-50",
  install: "bg-emerald-100/80 border-emerald-400/60 text-emerald-950 dark:bg-emerald-900/40 dark:border-emerald-500/60 dark:text-emerald-50",
  delivery: "bg-blue-100/80 border-blue-400/60 text-blue-950 dark:bg-blue-900/40 dark:border-blue-500/60 dark:text-blue-50",
  pickup: "bg-sky-100/80 border-sky-400/60 text-sky-950 dark:bg-sky-900/40 dark:border-sky-500/60 dark:text-sky-50",
  other: "bg-zinc-100/80 border-zinc-400/60 text-zinc-950 dark:bg-zinc-900/40 dark:border-zinc-500/60 dark:text-zinc-50",
};

// Cancelled / no_show / complete render with reduced visual weight so the
// active week is what the eye lands on first.
function isTerminal(status: string): boolean {
  return status === "cancelled" || status === "no_show" || status === "complete";
}

type Props = {
  event: CalendarEvent;
  timeZone: string;
  size?: "sm" | "md";
};

export function EventBlock({ event, timeZone, size = "sm" }: Props) {
  const kindClass = KIND_BG[event.kind] ?? KIND_BG.other;
  const terminal = isTerminal(event.status);
  const startLabel = formatInTimeZone(event.startsAt, timeZone, "h:mm a");

  return (
    <div
      className={cn(
        "h-full overflow-hidden rounded-md border px-1.5 py-1 text-left",
        kindClass,
        terminal && "opacity-60",
      )}
      title={`${event.orderNumber} — ${event.projectName ?? "Untitled"}`}
    >
      <div className="flex items-center justify-between gap-1 text-[10px] leading-tight">
        <span className={cn("font-mono font-medium", terminal && "line-through")}>
          {event.orderNumber}
        </span>
        <span className="opacity-80">{startLabel}</span>
      </div>
      <p
        className={cn(
          "truncate font-medium leading-tight",
          size === "md" ? "text-sm" : "text-xs",
        )}
      >
        {event.projectName ?? "Untitled"}
      </p>
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
