import Link from "next/link";
import { addDays } from "date-fns";
import { Plus } from "lucide-react";

import { getCurrentUserAndOrg } from "@/lib/auth";
import {
  formatInTimeZone,
  parseLocalDateTime,
  startOfWeekInTz,
  tzAbbreviation,
} from "@/lib/tz";
import {
  getEventForEdit,
  listCalendarEvents,
  listOrdersForEventPicker,
} from "@/lib/queries/events";
import { listCrewLite } from "@/lib/queries/crew";
import { Button } from "@/components/ui/button";
import { CalendarGrid } from "@/components/app/calendar-grid";
import { CalendarList } from "@/components/app/calendar-list";
import { EventDialog } from "@/components/app/event-dialog";
import { ScheduleNav } from "@/components/app/schedule-nav";
import { ScheduleFilterBar } from "@/components/app/schedule-filter-bar";
import { ScheduleViewTabs, type ScheduleView } from "@/components/app/schedule-view-tabs";
import { EVENT_KINDS, EVENT_STATUSES } from "@/lib/validators/events";

type SearchParams = {
  view?: string;
  date?: string;
  event?: string;
  time?: string;
  order?: string;
  kind?: string;
  crew?: string;
  status?: string;
  q?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: string;
  page?: string;
};

export const metadata = { title: "Schedule · Stone & Design Board" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseCommaList<T extends string>(value: string | undefined, allowed: readonly T[]): T[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => (allowed as readonly string[]).includes(s));
}

function parseUuidList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { org } = await getCurrentUserAndOrg();
  const tz = org.timezone;

  const view: ScheduleView =
    searchParams.view === "day" ? "day" : searchParams.view === "list" ? "list" : "week";

  const kinds = parseCommaList(searchParams.kind, EVENT_KINDS);
  const crewIds = parseUuidList(searchParams.crew);
  const statuses = parseCommaList(searchParams.status, EVENT_STATUSES);
  const search = searchParams.q ?? "";

  const anchorDateStr =
    searchParams.date && DATE_RE.test(searchParams.date)
      ? searchParams.date
      : formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  const anchorAsUtc = new Date(`${anchorDateStr}T12:00:00Z`);

  // Per-view time window
  let fromUtc: string;
  let toUtc: string;
  let weekStart: Date;
  let label: string;

  if (view === "week") {
    weekStart = startOfWeekInTz(anchorAsUtc, tz);
    fromUtc = weekStart.toISOString();
    toUtc = addDays(weekStart, 7).toISOString();
    label = `${formatInTimeZone(weekStart, tz, "MMM d")} – ${formatInTimeZone(
      addDays(weekStart, 6),
      tz,
      "MMM d, yyyy",
    )}`;
  } else if (view === "day") {
    weekStart = parseLocalDateTime(anchorDateStr, "00:00", tz);
    fromUtc = weekStart.toISOString();
    toUtc = addDays(weekStart, 1).toISOString();
    label = formatInTimeZone(weekStart, tz, "EEE, MMM d, yyyy");
  } else {
    // list: respect ?from/?to if set, else show everything from today onward.
    const fromStr =
      searchParams.from && DATE_RE.test(searchParams.from) ? searchParams.from : null;
    const toStr =
      searchParams.to && DATE_RE.test(searchParams.to) ? searchParams.to : null;
    const fromDate = fromStr
      ? parseLocalDateTime(fromStr, "00:00", tz)
      : new Date("1970-01-01T00:00:00Z");
    const toDate = toStr
      ? // To-inclusive: bump by 1 day to capture events on that date.
        addDays(parseLocalDateTime(toStr, "00:00", tz), 1)
      : new Date("2099-12-31T00:00:00Z");
    fromUtc = fromDate.toISOString();
    toUtc = toDate.toISOString();
    weekStart = parseLocalDateTime(anchorDateStr, "00:00", tz);
    if (fromStr && toStr) label = `${fromStr} → ${toStr}`;
    else if (fromStr) label = `From ${fromStr}`;
    else if (toStr) label = `Through ${toStr}`;
    else label = "All events";
  }

  const todayLocalDate = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");

  const eventParam = searchParams.event ?? null;
  const showCreate = eventParam === "new";
  const editEventId = eventParam && UUID_RE.test(eventParam) ? eventParam : null;
  const showDialog = showCreate || editEventId !== null;

  const [events, crewLite, orders, editEvent] = await Promise.all([
    listCalendarEvents({
      fromUtc,
      toUtc,
      kinds,
      crewIds,
      statuses,
      search,
    }),
    // Always load active crew for the filter bar; include inactive when
    // they appear in the current filter so the chip count stays accurate.
    listCrewLite(false),
    showDialog ? listOrdersForEventPicker() : Promise.resolve([]),
    editEventId ? getEventForEdit(editEventId) : Promise.resolve(null),
  ]);

  // Navigator hrefs depend on view
  const navHrefs = (() => {
    if (view === "week") {
      return {
        prev: hrefWith(searchParams, {
          date: formatInTimeZone(addDays(weekStart, -7), tz, "yyyy-MM-dd"),
        }),
        next: hrefWith(searchParams, {
          date: formatInTimeZone(addDays(weekStart, 7), tz, "yyyy-MM-dd"),
        }),
        today: hrefWith(searchParams, { date: null }),
      };
    }
    if (view === "day") {
      return {
        prev: hrefWith(searchParams, {
          date: formatInTimeZone(addDays(weekStart, -1), tz, "yyyy-MM-dd"),
        }),
        next: hrefWith(searchParams, {
          date: formatInTimeZone(addDays(weekStart, 1), tz, "yyyy-MM-dd"),
        }),
        today: hrefWith(searchParams, { date: null }),
      };
    }
    // list has no prev/next; use Today to clear date params.
    return {
      prev: hrefWith(searchParams, { date: null }),
      next: hrefWith(searchParams, { date: null }),
      today: hrefWith(searchParams, { date: null, from: null, to: null }),
    };
  })();

  const newEventHref = (() => {
    const params = new URLSearchParams(toRecord(searchParams));
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
            {label} · {tzAbbreviation(tz)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ScheduleViewTabs current={view} />
          {view !== "list" ? (
            <ScheduleNav
              prevHref={navHrefs.prev}
              nextHref={navHrefs.next}
              todayHref={navHrefs.today}
            />
          ) : null}
          <Button asChild size="sm" className="gap-1">
            <Link href={newEventHref}>
              <Plus className="h-4 w-4" /> New event
            </Link>
          </Button>
        </div>
      </header>

      <ScheduleFilterBar crewOptions={crewLite} showDateRange={view === "list"} />

      {view === "list" ? (
        <CalendarList events={events} timeZone={tz} />
      ) : (
        <>
          {events.length === 0 ? (
            <div className="rounded-xl border bg-card p-12 text-center">
              <p className="text-sm font-medium">Nothing scheduled.</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                Use <strong>+ New event</strong> to add a measurement or install,
                or click any time slot below to pre-fill the date and time.
              </p>
            </div>
          ) : null}
          <CalendarGrid
            days={view === "week" ? sevenFrom(weekStart) : [weekStart]}
            events={events}
            timeZone={tz}
            todayLocalDate={todayLocalDate}
            hourPx={view === "day" ? 80 : 56}
          />
        </>
      )}

      {showDialog ? (
        <EventDialog
          mode={editEventId ? "edit" : "create"}
          timeZone={tz}
          orders={orders}
          crew={crewLite.filter((c) => c.isActive)}
          initial={editEvent ?? undefined}
          initialDate={searchParams.date ?? null}
          initialTime={searchParams.time ?? null}
          initialOrderId={searchParams.order ?? null}
        />
      ) : null}
    </div>
  );
}

function sevenFrom(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function toRecord(sp: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return out;
}

function hrefWith(
  current: Record<string, string | undefined>,
  next: Record<string, string | null>,
): string {
  const params = new URLSearchParams(toRecord(current));
  for (const [k, v] of Object.entries(next)) {
    if (v === null) params.delete(k);
    else params.set(k, v);
  }
  const str = params.toString();
  return `/schedule${str ? `?${str}` : ""}`;
}

