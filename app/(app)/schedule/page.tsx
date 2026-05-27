import Link from "next/link";
import { addDays } from "date-fns";
import { Plus } from "lucide-react";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { formatInTimeZone, startOfWeekInTz, tzAbbreviation } from "@/lib/tz";
import {
  getEventForEdit,
  listCalendarEvents,
  listOrdersForEventPicker,
} from "@/lib/queries/events";
import { listCrewLite } from "@/lib/queries/crew";
import { Button } from "@/components/ui/button";
import { CalendarWeek } from "@/components/app/calendar-week";
import { EventDialog } from "@/components/app/event-dialog";
import { ScheduleNav } from "@/components/app/schedule-nav";

type SearchParams = {
  date?: string;       // YYYY-MM-DD; anchors the week
  event?: string;      // "new" | <uuid>
  // pre-fill when launching from "click empty slot":
  time?: string;       // HH:mm
  order?: string;      // uuid (for pre-selecting an order)
};

export const metadata = { title: "Schedule · Stone & Design Board" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { org } = await getCurrentUserAndOrg();
  const tz = org.timezone;

  // Anchor date: the URL param if valid, else "today in org tz".
  const anchorDateStr =
    searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date)
      ? searchParams.date
      : formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  const anchorAsUtc = new Date(`${anchorDateStr}T12:00:00Z`); // noon to avoid edge-of-day flip

  const weekStart = startOfWeekInTz(anchorAsUtc, tz);
  const weekEnd = addDays(weekStart, 7);
  const todayLocalDate = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");

  const eventParam = searchParams.event ?? null;
  const showCreate = eventParam === "new";
  const editEventId = eventParam && UUID_RE.test(eventParam) ? eventParam : null;
  const showDialog = showCreate || editEventId !== null;

  const [events, orders, crew, editEvent] = await Promise.all([
    listCalendarEvents({
      fromUtc: weekStart.toISOString(),
      toUtc: weekEnd.toISOString(),
    }),
    showDialog ? listOrdersForEventPicker() : Promise.resolve([]),
    showDialog ? listCrewLite(true) : Promise.resolve([]),
    editEventId ? getEventForEdit(editEventId) : Promise.resolve(null),
  ]);

  const weekLabel = `${formatInTimeZone(weekStart, tz, "MMM d")} – ${formatInTimeZone(
    addDays(weekStart, 6),
    tz,
    "MMM d, yyyy",
  )}`;

  const prevAnchor = formatInTimeZone(addDays(weekStart, -7), tz, "yyyy-MM-dd");
  const nextAnchor = formatInTimeZone(addDays(weekStart, 7), tz, "yyyy-MM-dd");

  const newEventHref = (() => {
    const params = new URLSearchParams();
    params.set("event", "new");
    params.set("date", anchorDateStr);
    return `/schedule?${params.toString()}`;
  })();

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-6 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
          <p className="text-sm text-muted-foreground">
            {weekLabel} · {tzAbbreviation(tz)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ScheduleNav
            prevHref={`/schedule?date=${prevAnchor}`}
            nextHref={`/schedule?date=${nextAnchor}`}
            todayHref="/schedule"
          />
          <Button asChild size="sm" className="gap-1">
            <Link href={newEventHref}>
              <Plus className="h-4 w-4" /> New event
            </Link>
          </Button>
        </div>
      </header>

      {events.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <p className="text-sm font-medium">Nothing scheduled this week.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Use <strong>+ New event</strong> to add a measurement or install,
            or click any time slot below to pre-fill the date and time.
          </p>
        </div>
      ) : null}

      <CalendarWeek
        weekStart={weekStart}
        events={events}
        timeZone={tz}
        todayLocalDate={todayLocalDate}
      />

      {showDialog ? (
        <EventDialog
          mode={editEventId ? "edit" : "create"}
          timeZone={tz}
          orders={orders}
          crew={crew}
          initial={editEvent ?? undefined}
          initialDate={searchParams.date ?? null}
          initialTime={searchParams.time ?? null}
          initialOrderId={searchParams.order ?? null}
        />
      ) : null}
    </div>
  );
}

