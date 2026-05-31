"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatInTimeZone, parseLocalDateTime } from "@/lib/tz";
import type { CalendarEvent } from "@/lib/queries/events";
import {
  getCrewConflicts,
  rescheduleOrderEvent,
} from "@/lib/actions/events";
import { EventBlock } from "./event-block";

type Props = {
  days: Date[];
  events: CalendarEvent[];
  timeZone: string;
  todayLocalDate: string;
  hourPx?: number;
};

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 20;
const HOURS = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
  (_, i) => DAY_START_HOUR + i,
);

const SLOT_ID_RE = /^slot:(\d{4}-\d{2}-\d{2}):(\d{1,2})$/;
const ALLDAY_ID_RE = /^allday:(\d{4}-\d{2}-\d{2})$/;

export function CalendarGrid({
  days,
  events,
  timeZone,
  todayLocalDate,
  hourPx = 56,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Local optimistic copy. Re-sync whenever the prop changes (e.g. after
  // router.refresh()).
  const [localEvents, setLocalEvents] = useState<CalendarEvent[]>(events);
  useEffect(() => setLocalEvents(events), [events]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const dayKeys = days.map((d) => formatInTimeZone(d, timeZone, "yyyy-MM-dd"));
  const isSingleDay = days.length === 1;

  // Split events: all-day events render in a strip above the hour grid;
  // timed events position by hour inside the grid. Keep the maps separate
  // so each strip's drag-end handler can target the right zone.
  const allDayByDay = new Map<string, CalendarEvent[]>();
  const timedByDay = new Map<string, CalendarEvent[]>();
  for (const ev of localEvents) {
    const key = formatInTimeZone(ev.startsAt, timeZone, "yyyy-MM-dd");
    const target = ev.isAllDay ? allDayByDay : timedByDay;
    const list = target.get(key) ?? [];
    list.push(ev);
    target.set(key, list);
  }
  // Whether any visible day has any all-day events. If not, the strip
  // doesn't render at all (saves vertical space).
  const hasAnyAllDay = dayKeys.some((k) => (allDayByDay.get(k) ?? []).length > 0);

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

  // Same as openNew, but the all-day strip click pre-fills the date and
  // signals the dialog should default to All day. Sub-step 3 doesn't yet
  // read a URL param for the all-day default — for now the dialog opens
  // in timed mode and the user toggles the checkbox. Flagging this as a
  // small follow-up; not load-bearing.
  function openNewAllDay(dateKey: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("event", "new");
    params.set("date", dateKey);
    router.push(`/schedule?${params.toString()}`);
  }

  async function handleDragEnd(e: DragEndEvent) {
    const overId = e.over?.id;
    const draggedId = e.active.id;
    if (typeof overId !== "string" || typeof draggedId !== "string") return;
    if (!draggedId.startsWith("event:")) return;

    const eventId = draggedId.slice("event:".length);
    const event = localEvents.find((ev) => ev.id === eventId);
    if (!event) return;

    const slotMatch = SLOT_ID_RE.exec(overId);
    const allDayMatch = ALLDAY_ID_RE.exec(overId);

    // Cross-strip drags are rejected: converting a timed event to all-day
    // (or vice versa) is more than a positional change — it's a
    // semantic shift that needs the dialog. Avoid silently flipping
    // is_all_day under the user.
    if (event.isAllDay && slotMatch) {
      toast.error("Open the event to convert all-day → timed.");
      return;
    }
    if (!event.isAllDay && allDayMatch) {
      toast.error("Open the event to convert timed → all-day.");
      return;
    }

    let newDateKey: string;
    let newStartTime: string;
    if (allDayMatch) {
      newDateKey = allDayMatch[1] as string;
      newStartTime = "00:00";
    } else if (slotMatch) {
      newDateKey = slotMatch[1] as string;
      newStartTime = `${String(Number(slotMatch[2])).padStart(2, "0")}:00`;
    } else {
      return;
    }

    const oldDateKey = formatInTimeZone(event.startsAt, timeZone, "yyyy-MM-dd");
    const oldHour = Number(formatInTimeZone(event.startsAt, timeZone, "H"));
    if (event.isAllDay) {
      if (oldDateKey === newDateKey) return; // no-op
    } else {
      const newHour = Number(slotMatch?.[2] ?? 0);
      if (oldDateKey === newDateKey && oldHour === newHour) return; // no-op
    }

    const newStartsAt = parseLocalDateTime(newDateKey, newStartTime, timeZone);
    const effectiveDuration = event.isAllDay ? 1440 : event.durationMin;
    const newEndsAt = new Date(newStartsAt.getTime() + effectiveDuration * 60_000);

    // Same-UTC-day rule (matches the DB CHECK). Cheap to detect here so the
    // user gets a friendly toast instead of a server-side "check_violation".
    // All-day events bypass this check (matches the relaxed table CHECK
    // from 0016).
    if (
      !event.isAllDay && (
        newStartsAt.getUTCFullYear() !== newEndsAt.getUTCFullYear() ||
        newStartsAt.getUTCMonth() !== newEndsAt.getUTCMonth() ||
        newStartsAt.getUTCDate() !== newEndsAt.getUTCDate()
      )
    ) {
      toast.error("Can't reschedule there — event would cross UTC midnight.");
      return;
    }

    // Optimistic update.
    const prevEvents = localEvents;
    setLocalEvents((curr) =>
      curr.map((ev) =>
        ev.id === eventId
          ? { ...ev, startsAt: newStartsAt.toISOString(), endsAt: newEndsAt.toISOString() }
          : ev,
      ),
    );

    startTransition(async () => {
      const res = await rescheduleOrderEvent({
        eventId,
        date: newDateKey,
        startTime: newStartTime,
        durationMin: event.durationMin,
      });
      if (!res.ok) {
        setLocalEvents(prevEvents);
        toast.error("Couldn't reschedule", { description: res.error });
        return;
      }

      // Date-only label for all-day events; the action layer ignores time.
      toast.success(
        event.isAllDay
          ? `Rescheduled to ${formatInTimeZone(newStartsAt, timeZone, "EEE, MMM d (all day)")}`
          : `Rescheduled to ${formatInTimeZone(newStartsAt, timeZone, "EEE, MMM d, h:mm a")}`,
      );

      // Post-drop conflict check — surface as a separate warning toast so
      // the success is acknowledged first. Skip when no crew assigned.
      if (event.crew.length > 0) {
        try {
          const conflicts = await getCrewConflicts({
            crewIds: event.crew.map((c) => c.id),
            startsAtIso: newStartsAt.toISOString(),
            endsAtIso: newEndsAt.toISOString(),
            excludeEventId: eventId,
          });
          if (conflicts.length > 0) {
            const first = conflicts[0];
            const member = first ? event.crew.find((c) => c.id === first.crewMemberId) : null;
            if (first) {
              toast.warning(
                `${member?.name ?? "Crew"} now overlaps ${first.orderNumber}`,
                {
                  description: `${formatInTimeZone(first.startsAt, timeZone, "h:mm a")}–${formatInTimeZone(first.endsAt, timeZone, "h:mm a")}${
                    conflicts.length > 1 ? ` (+${conflicts.length - 1} more)` : ""
                  }`,
                },
              );
            }
          }
        } catch {
          // Non-fatal — the reschedule itself succeeded.
        }
      }

      router.refresh();
    });
  }

  const gridCols = `64px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
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

        {/* All-day strip — only renders when at least one visible day has
            an all-day event. Vertical-drag inside the strip is a no-op;
            horizontal drag to a different day reschedules to that day. */}
        {hasAnyAllDay ? (
          <div
            className="grid border-b bg-muted/10"
            style={{ gridTemplateColumns: gridCols }}
          >
            <div className="border-r px-2 py-1 text-[9px] uppercase tracking-wide text-muted-foreground">
              all-day
            </div>
            {dayKeys.map((dateKey, dayIdx) => {
              const isWeekend = !isSingleDay && (dayIdx === 0 || dayIdx === 6);
              const isToday = dateKey === todayLocalDate;
              const pills = allDayByDay.get(dateKey) ?? [];
              return (
                <AllDayCell
                  key={dateKey}
                  dateKey={dateKey}
                  events={pills}
                  timeZone={timeZone}
                  highlight={isWeekend ? "weekend" : isToday ? "today" : "none"}
                  onClick={() => openNewAllDay(dateKey)}
                  onOpen={openEvent}
                />
              );
            })}
          </div>
        ) : null}

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
            const dayEvents = timedByDay.get(dateKey) ?? [];
            return (
              <div
                key={dateKey}
                className={cn(
                  "relative border-l",
                  isWeekend && "bg-muted/10",
                  isToday && "bg-brand/5",
                )}
              >
                {HOURS.map((h) => (
                  <DropHourSlot
                    key={h}
                    dateKey={dateKey}
                    hour={h}
                    hourPx={hourPx}
                    onClick={() => openNew(dateKey, h)}
                  />
                ))}

                {dayEvents.map((ev) => {
                  const { top, height } = positionFor(ev, timeZone, hourPx);
                  if (height <= 0) return null;
                  return (
                    <DraggableEvent
                      key={ev.id}
                      event={ev}
                      timeZone={timeZone}
                      top={top}
                      height={height}
                      onClick={() => openEvent(ev.id)}
                      size={isSingleDay ? "md" : "sm"}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </DndContext>
  );
}

function DropHourSlot({
  dateKey,
  hour,
  hourPx,
  onClick,
}: {
  dateKey: string;
  hour: number;
  hourPx: number;
  onClick: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `slot:${dateKey}:${hour}` });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      className={cn(
        "block w-full border-b border-border/60 hover:bg-accent/30",
        isOver && "bg-brand/20",
      )}
      style={{ height: `${hourPx}px` }}
      aria-label={`New event ${dateKey} ${hourLabel(hour)}`}
    />
  );
}

function DraggableEvent({
  event,
  timeZone,
  top,
  height,
  onClick,
  size,
}: {
  event: CalendarEvent;
  timeZone: string;
  top: number;
  height: number;
  onClick: () => void;
  size: "sm" | "md";
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `event:${event.id}`,
  });

  const dragStyle = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {};

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      className={cn(
        "absolute left-1 right-1 cursor-grab select-none active:cursor-grabbing",
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
      style={{ top: `${top}px`, height: `${height}px`, ...dragStyle }}
      {...attributes}
      {...listeners}
    >
      <EventBlock event={event} timeZone={timeZone} size={size} />
    </button>
  );
}

// One cell in the all-day row. useDroppable so drag-end can move all-day
// events between days; nested useDraggable pills are the events themselves.
function AllDayCell({
  dateKey,
  events,
  timeZone,
  highlight,
  onClick,
  onOpen,
}: {
  dateKey: string;
  events: CalendarEvent[];
  timeZone: string;
  highlight: "today" | "weekend" | "none";
  onClick: () => void;
  onOpen: (eventId: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `allday:${dateKey}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[28px] space-y-0.5 border-l p-1",
        highlight === "weekend" && "bg-muted/10",
        highlight === "today" && "bg-brand/5",
        isOver && "bg-brand/20",
      )}
      onClick={onClick}
      role="button"
      tabIndex={-1}
    >
      {events.map((ev) => (
        <DraggableAllDayPill
          key={ev.id}
          event={ev}
          timeZone={timeZone}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function DraggableAllDayPill({
  event,
  timeZone,
  onOpen,
}: {
  event: CalendarEvent;
  timeZone: string;
  onOpen: (eventId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `event:${event.id}`,
  });
  const dragStyle = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {};
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(event.id);
      }}
      className={cn(
        "block w-full cursor-grab select-none active:cursor-grabbing",
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
      style={dragStyle}
      {...attributes}
      {...listeners}
    >
      <EventBlock event={event} timeZone={timeZone} variant="pill" />
    </button>
  );
}

function hourLabel(h: number): string {
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12} ${period}`;
}

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
