"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Calendar,
  Check,
  ExternalLink,
  MapPin,
  MessageCircle,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { formatInTimeZone } from "@/lib/tz";
import {
  deleteOrderEvent,
  updateOrderEventStatus,
} from "@/lib/actions/events";
import type { CalendarEvent } from "@/lib/queries/events";

type Props = {
  events: CalendarEvent[];
  orderId: string;
  timeZone: string;
};

const KIND_LABEL: Record<string, string> = {
  measurement: "Measurement",
  install: "Install",
  delivery: "Delivery",
  pickup: "Pickup",
  other: "Other",
};

const KIND_CHIP: Record<string, string> = {
  measurement:
    "bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-100",
  install:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  delivery: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  pickup: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  other: "bg-zinc-100 text-zinc-900 dark:bg-zinc-900/40 dark:text-zinc-100",
};

const STATUS_PILL: Record<string, string> = {
  scheduled: "bg-muted text-muted-foreground",
  en_route:
    "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  in_progress:
    "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  complete:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  cancelled: "bg-destructive/15 text-destructive",
  no_show: "bg-destructive/15 text-destructive",
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  en_route: "En route",
  in_progress: "In progress",
  complete: "Complete",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export function OrderEventsTab({ events, orderId, timeZone }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function hrefWithEvent(eventId: string): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set("event", eventId);
    return `/orders?${params.toString()}`;
  }

  function newEventHref(): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set("event", "new");
    return `/orders?${params.toString()}`;
  }

  function sendHref(eventId: string): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set("send", eventId);
    return `/orders?${params.toString()}`;
  }

  function scheduleHref(eventId: string): string {
    // Jump to the schedule view filtered to this event's day.
    const ev = events.find((e) => e.id === eventId);
    if (!ev) return "/schedule";
    const date = formatInTimeZone(ev.startsAt, timeZone, "yyyy-MM-dd");
    return `/schedule?view=day&date=${date}`;
  }

  function markComplete(eventId: string) {
    startTransition(async () => {
      const res = await updateOrderEventStatus({ eventId, status: "complete" });
      if (!res.ok) {
        toast.error("Couldn't update status", { description: res.error });
        return;
      }
      toast.success("Marked complete");
      router.refresh();
    });
  }

  function destroy(eventId: string) {
    startTransition(async () => {
      const res = await deleteOrderEvent({ eventId });
      if (!res.ok) {
        toast.error("Couldn't delete event", { description: res.error });
        return;
      }
      toast.success("Event deleted");
      router.refresh();
    });
  }

  // Split past vs future based on starts_at; past events go below.
  const nowIso = new Date().toISOString();
  const future = events.filter((e) => e.startsAt >= nowIso);
  const past = events.filter((e) => e.startsAt < nowIso);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Schedule measurements, installs, deliveries. Each event has its own
          time, crew, and location.
        </p>
        <Button asChild size="sm" className="gap-1">
          <Link href={newEventHref()}>
            <Plus className="h-4 w-4" /> Add event
          </Link>
        </Button>
      </div>

      {events.length === 0 ? (
        <div className="rounded-md border bg-muted/30 p-8 text-center">
          <Calendar className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
          <p className="text-sm font-medium">No events for this order yet.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Add a measurement or install to put it on the calendar and assign
            crew. The customer&apos;s address will pre-fill the location.
          </p>
        </div>
      ) : null}

      {future.length > 0 ? (
        <ul className="space-y-3">
          {future.map((ev) => (
            <EventRow
              key={ev.id}
              event={ev}
              timeZone={timeZone}
              hrefEdit={hrefWithEvent(ev.id)}
              hrefSchedule={scheduleHref(ev.id)}
              hrefSend={sendHref(ev.id)}
              onMarkComplete={() => markComplete(ev.id)}
              onDelete={() => destroy(ev.id)}
              pending={pending}
              orderId={orderId}
            />
          ))}
        </ul>
      ) : null}

      {past.length > 0 ? (
        <>
          <p className="pt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            Past
          </p>
          <ul className="space-y-3">
            {past.map((ev) => (
              <EventRow
                key={ev.id}
                event={ev}
                timeZone={timeZone}
                hrefEdit={hrefWithEvent(ev.id)}
                hrefSchedule={scheduleHref(ev.id)}
                hrefSend={sendHref(ev.id)}
                onMarkComplete={() => markComplete(ev.id)}
                onDelete={() => destroy(ev.id)}
                pending={pending}
                orderId={orderId}
              />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function EventRow({
  event,
  timeZone,
  hrefEdit,
  hrefSchedule,
  hrefSend,
  onMarkComplete,
  onDelete,
  pending,
  orderId,
}: {
  event: CalendarEvent;
  timeZone: string;
  hrefEdit: string;
  hrefSchedule: string;
  hrefSend: string;
  onMarkComplete: () => void;
  onDelete: () => void;
  pending: boolean;
  orderId: string;
}) {
  void orderId;
  const isComplete = event.status === "complete";
  const isTerminal = isComplete || event.status === "cancelled" || event.status === "no_show";

  return (
    <li className="rounded-md border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                KIND_CHIP[event.kind] ?? KIND_CHIP.other,
              )}
            >
              {KIND_LABEL[event.kind] ?? event.kind}
            </span>
            <span className="text-sm font-medium">
              {formatInTimeZone(event.startsAt, timeZone, "EEE, MMM d")}
            </span>
            <span className="text-sm text-muted-foreground">
              {formatInTimeZone(event.startsAt, timeZone, "h:mm a")}
              {" · "}
              {durationLabel(event.durationMin)}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                STATUS_PILL[event.status] ?? STATUS_PILL.scheduled,
              )}
            >
              {STATUS_LABEL[event.status] ?? event.status}
            </span>
          </div>

          {event.crew.length > 0 ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              {event.crew.map((c) => c.name).join(", ")}
            </p>
          ) : (
            <p className="text-xs italic text-muted-foreground">No crew assigned.</p>
          )}

          {event.locationText ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              {event.locationText}
            </p>
          ) : null}

          {event.notes ? (
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">
              {event.notes}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              asChild
              title="Open on schedule"
            >
              <Link href={hrefSchedule}>
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              asChild
              title="Edit event"
            >
              <Link href={hrefEdit}>
                <Pencil className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-destructive hover:text-destructive"
                  title="Delete event"
                  disabled={pending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this event?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Removes the event and its crew assignments. The order
                    itself is not affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <div className="flex items-center gap-1">
            {!isTerminal ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={onMarkComplete}
                disabled={pending}
                title="Mark complete"
              >
                <Check className="h-3 w-3" /> Mark done
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              asChild
              title="Send to crew"
            >
              <Link href={hrefSend}>
                <MessageCircle className="h-3 w-3" /> Send
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}

function durationLabel(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

