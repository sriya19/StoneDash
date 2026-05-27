"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";
import { formatInTimeZone } from "@/lib/tz";
import type { CalendarEvent } from "@/lib/queries/events";
import { EventBlock } from "./event-block";

type Props = {
  days: Date[]; // 1 day = day view, 7 days = week view
  events: CalendarEvent[];
  timeZone: string;
  todayLocalDate: string; // YYYY-MM-DD in org tz
  hourPx?: number; // taller for day view
};

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 20;
const HOURS = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
  (_, i) => DAY_START_HOUR + i,
);

export function CalendarGrid({
  days,
  events,
  timeZone,
  todayLocalDate,
  hourPx = 56,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const dayKeys = days.map((d) => formatInTimeZone(d, timeZone, "yyyy-MM-dd"));
  const isSingleDay = days.length === 1;

  // Group events by their org-local date.
  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const key = formatInTimeZone(ev.startsAt, timeZone, "yyyy-MM-dd");
    const list = eventsByDay.get(key) ?? [];
    list.push(ev);
    eventsByDay.set(key, list);
  }

  function openEvent(eventId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("event", eventId);
    router.push(`/schedule?${params.toString()}`);
  }

  function openNew(dateKey: string, hour: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("event", "new");
    params.set("date", dateKey);
    params.set("time", `${String(hour).padStart(2, "0")}:00`);
    router.push(`/schedule?${params.toString()}`);
  }

  const gridCols = `64px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {/* Day headers */}
      <div
        className="grid border-b bg-muted/30"
        style={{ gridTemplateColumns: gridCols }}
      >
        <div />
        {days.map((d, i) => {
          const key = dayKeys[i] as string;
          const isToday = key === todayLocalDate;
          // Weekend muting only meaningful for the 7-day week view (Sun = 0,
          // Sat = 6). On the day view we never mute the single visible day.
          const isWeekend = !isSingleDay && (i === 0 || i === 6);
          return (
            <div
              key={key}
              className={cn(
                "border-l px-2 py-2 text-center",
                isWeekend && "bg-muted/20 text-muted-foreground",
                isToday && "bg-brand/10",
              )}
            >
              <p className={cn("text-[10px] uppercase tracking-wide", isToday && "text-brand")}>
                {formatInTimeZone(d, timeZone, "EEE")}
              </p>
              <p
                className={cn(
                  "text-base font-semibold tabular-nums",
                  isToday && "text-brand",
                )}
              >
                {formatInTimeZone(d, timeZone, isSingleDay ? "MMM d" : "d")}
              </p>
            </div>
          );
        })}
      </div>

      {/* Grid body */}
      <div
        className="relative grid"
        style={{
          gridTemplateColumns: gridCols,
          height: `${HOURS.length * hourPx}px`,
        }}
      >
        {/* Hour labels column */}
        <div className="relative">
          {HOURS.map((h) => (
            <div
              key={h}
              className="border-b border-r px-2 text-[10px] text-muted-foreground"
              style={{ height: `${hourPx}px` }}
            >
              {hourLabel(h)}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {dayKeys.map((dateKey, dayIdx) => {
          const isWeekend = !isSingleDay && (dayIdx === 0 || dayIdx === 6);
          const isToday = dateKey === todayLocalDate;
          const dayEvents = eventsByDay.get(dateKey) ?? [];
          return (
            <div
              key={dateKey}
              className={cn(
                "relative border-l",
                isWeekend && "bg-muted/10",
                isToday && "bg-brand/5",
              )}
            >
              {/* Hour cells (click target for new event at slot top) */}
              {HOURS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => openNew(dateKey, h)}
                  className="block w-full border-b border-border/60 hover:bg-accent/30"
                  style={{ height: `${hourPx}px` }}
                  aria-label={`New event ${dateKey} ${hourLabel(h)}`}
                />
              ))}

              {/* Absolutely positioned events */}
              {dayEvents.map((ev) => {
                const { top, height } = positionFor(ev, timeZone, hourPx);
                if (height <= 0) return null;
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => openEvent(ev.id)}
                    className="absolute left-1 right-1"
                    style={{ top: `${top}px`, height: `${height}px` }}
                  >
                    <EventBlock
                      event={ev}
                      timeZone={timeZone}
                      size={isSingleDay ? "md" : "sm"}
                    />
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function hourLabel(h: number): string {
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12} ${period}`;
}

// Returns top + height in px, clamped to the visible range. Events that
// start before 6 AM or end after 8 PM are clipped at the boundaries.
function positionFor(
  ev: { startsAt: string; durationMin: number },
  timeZone: string,
  hourPx: number,
): { top: number; height: number } {
  const hourStr = formatInTimeZone(ev.startsAt, timeZone, "H");
  const minStr = formatInTimeZone(ev.startsAt, timeZone, "m");
  const startHour = Number(hourStr);
  const startMin = Number(minStr);
  const startMinutesFromTop = (startHour - DAY_START_HOUR) * 60 + startMin;
  const totalMinutesVisible = (DAY_END_HOUR - DAY_START_HOUR + 1) * 60;
  const top = Math.max(0, (startMinutesFromTop / 60) * hourPx);
  const endMinutesFromTop = Math.min(
    totalMinutesVisible,
    startMinutesFromTop + ev.durationMin,
  );
  const height = ((endMinutesFromTop - Math.max(0, startMinutesFromTop)) / 60) * hourPx;
  return { top, height };
}
