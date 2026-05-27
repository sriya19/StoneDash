"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format, parseISO } from "date-fns";
import { Check, ChevronsUpDown, Loader2, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { formatInTimeZone, parseLocalDateTime, tzAbbreviation } from "@/lib/tz";
import {
  createOrderEvent,
  deleteOrderEvent,
  getCrewConflicts,
  updateOrderEvent,
  type CrewConflict,
} from "@/lib/actions/events";
import {
  DEFAULT_DURATION_MIN,
  EVENT_KINDS,
  EVENT_KIND_LABELS,
  type EventKind,
} from "@/lib/validators/events";
import type { CalendarEvent, OrderForEventPicker } from "@/lib/queries/events";
import type { CrewLite } from "@/lib/queries/crew";

type Props = {
  mode: "create" | "edit";
  timeZone: string;
  orders: OrderForEventPicker[];
  crew: CrewLite[];
  initial?: CalendarEvent;
  initialDate?: string | null;
  initialTime?: string | null;
  initialOrderId?: string | null;
};

type AssignmentDraft = {
  crewMemberId: string;
  role: string;
};

const DURATION_PRESETS = [60, 120, 180, 240];

export function EventDialog({
  mode,
  timeZone,
  orders,
  crew,
  initial,
  initialDate,
  initialTime,
  initialOrderId,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);
  const [conflicts, setConflicts] = useState<CrewConflict[]>([]);
  const [conflictBusy, setConflictBusy] = useState(false);

  const [orderId, setOrderId] = useState<string>(
    initial?.orderId ?? initialOrderId ?? "",
  );
  const [kind, setKind] = useState<EventKind>(
    (initial?.kind as EventKind | undefined) ?? "install",
  );
  const initialDateStr = initial
    ? formatInTimeZone(initial.startsAt, timeZone, "yyyy-MM-dd")
    : initialDate ?? formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd");
  const initialTimeStr = initial
    ? formatInTimeZone(initial.startsAt, timeZone, "HH:mm")
    : initialTime ?? "10:00";
  const [date, setDate] = useState<string>(initialDateStr);
  const [startTime, setStartTime] = useState<string>(initialTimeStr);
  const [durationMin, setDurationMin] = useState<number>(
    initial?.durationMin ?? DEFAULT_DURATION_MIN.install,
  );
  const [locationText, setLocationText] = useState<string>(
    initial?.locationText ?? "",
  );
  const [notes, setNotes] = useState<string>(initial?.notes ?? "");
  const [assignments, setAssignments] = useState<AssignmentDraft[]>(
    initial
      ? initial.crew.map((c) => ({ crewMemberId: c.id, role: c.role ?? "" }))
      : [],
  );
  const [orderOpen, setOrderOpen] = useState(false);
  const [crewOpen, setCrewOpen] = useState(false);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === orderId) ?? null,
    [orders, orderId],
  );

  // When user changes kind, snap duration to its default if the value still
  // matches the previous kind's default (don't clobber a custom duration).
  function changeKind(next: EventKind) {
    setKind(next);
    if (DURATION_PRESETS.includes(durationMin) || durationMin === DEFAULT_DURATION_MIN[kind]) {
      setDurationMin(DEFAULT_DURATION_MIN[next]);
    }
  }

  // Auto-default location_text from customer address when the order changes,
  // unless the user has already typed something.
  function changeOrder(id: string) {
    setOrderId(id);
    setOrderOpen(false);
    const next = orders.find((o) => o.id === id);
    if (next?.defaultLocation && locationText.trim() === "") {
      setLocationText(next.defaultLocation);
    }
  }

  function addCrew(memberId: string) {
    if (assignments.some((a) => a.crewMemberId === memberId)) return;
    const member = crew.find((c) => c.id === memberId);
    setAssignments((prev) => [
      ...prev,
      { crewMemberId: memberId, role: member?.role ?? "" },
    ]);
  }

  function removeCrew(memberId: string) {
    setAssignments((prev) => prev.filter((a) => a.crewMemberId !== memberId));
  }

  function setAssignmentRole(memberId: string, role: string) {
    setAssignments((prev) =>
      prev.map((a) => (a.crewMemberId === memberId ? { ...a, role } : a)),
    );
  }

  // Debounced conflict check. Runs on changes to crew, date, time, duration.
  useEffect(() => {
    if (assignments.length === 0) {
      setConflicts([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const starts = parseLocalDateTime(date, startTime, timeZone);
        const ends = new Date(starts.getTime() + durationMin * 60_000);
        setConflictBusy(true);
        const result = await getCrewConflicts({
          crewIds: assignments.map((a) => a.crewMemberId),
          startsAtIso: starts.toISOString(),
          endsAtIso: ends.toISOString(),
          excludeEventId: initial?.id,
        });
        if (!cancelled) setConflicts(result);
      } catch {
        if (!cancelled) setConflicts([]);
      } finally {
        if (!cancelled) setConflictBusy(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [assignments, date, startTime, durationMin, timeZone, initial?.id]);

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("event");
    params.delete("date");
    params.delete("time");
    // Note: don't strip "order" — it's used by the orders page to keep
    // the detail sheet open. On /schedule it has no semantic effect.
    const next = params.toString();
    router.push(`${pathname}${next ? `?${next}` : ""}`);
  }

  function submit() {
    if (!orderId) {
      toast.error("Pick an order first");
      return;
    }
    const payload = {
      orderId,
      kind,
      date,
      startTime,
      durationMin,
      locationText,
      notes,
      assignments: assignments.map((a) => ({
        crewMemberId: a.crewMemberId,
        role: a.role,
      })),
    };
    startTransition(async () => {
      const res = mode === "edit" && initial
        ? await updateOrderEvent({ ...payload, eventId: initial.id })
        : await createOrderEvent(payload);
      if (!res.ok) {
        toast.error(mode === "edit" ? "Couldn't save event" : "Couldn't create event", {
          description: res.error,
        });
        return;
      }
      toast.success(mode === "edit" ? "Event saved" : "Event created");
      close();
      router.refresh();
    });
  }

  function destroy() {
    if (!initial) return;
    setDeleting(true);
    startTransition(async () => {
      const res = await deleteOrderEvent({ eventId: initial.id });
      setDeleting(false);
      if (!res.ok) {
        toast.error("Couldn't delete event", { description: res.error });
        return;
      }
      toast.success("Event deleted");
      close();
      router.refresh();
    });
  }

  const conflictsByCrew = useMemo(() => {
    const map = new Map<string, CrewConflict[]>();
    for (const c of conflicts) {
      const list = map.get(c.crewMemberId) ?? [];
      list.push(c);
      map.set(c.crewMemberId, list);
    }
    return map;
  }, [conflicts]);

  return (
    <Dialog open onOpenChange={(next) => (!next ? close() : null)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit event" : "New event"}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {/* Order */}
          <div className="space-y-1.5">
            <Label>Order</Label>
            <Popover open={orderOpen} onOpenChange={setOrderOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  type="button"
                  className="w-full justify-between font-normal"
                  disabled={mode === "edit"}
                >
                  {selectedOrder
                    ? `${selectedOrder.orderNumber} — ${selectedOrder.projectName ?? "Untitled"}`
                    : "Pick an order…"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                <Command>
                  <CommandInput placeholder="Search by order # or project…" />
                  <CommandList>
                    <CommandEmpty>No orders match.</CommandEmpty>
                    <CommandGroup>
                      {orders.map((o) => (
                        <CommandItem
                          key={o.id}
                          value={`${o.orderNumber} ${o.projectName ?? ""} ${o.customerName ?? ""}`}
                          onSelect={() => changeOrder(o.id)}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              orderId === o.id ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <span className="flex flex-1 flex-col">
                            <span className="font-mono text-xs">{o.orderNumber}</span>
                            <span className="text-xs">{o.projectName ?? "Untitled"}</span>
                            {o.customerName ? (
                              <span className="text-[10px] text-muted-foreground">
                                {o.customerName}
                              </span>
                            ) : null}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Kind */}
          <div className="space-y-1.5">
            <Label>Kind</Label>
            <div className="grid grid-cols-5 gap-1">
              {EVENT_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => changeKind(k)}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-xs",
                    kind === k
                      ? "border-brand bg-brand/10 font-medium text-brand"
                      : "border-border hover:bg-accent",
                  )}
                >
                  {EVENT_KIND_LABELS[k]}
                </button>
              ))}
            </div>
          </div>

          {/* Date + time + duration */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ev-date">Date</Label>
              <Input
                id="ev-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-time">Start time</Label>
              <Input
                id="ev-time"
                type="time"
                step={900}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                {tzAbbreviation(timeZone)}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-duration">Duration (min)</Label>
              <Input
                id="ev-duration"
                type="number"
                min={1}
                step={15}
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value || 0))}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {DURATION_PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setDurationMin(m)}
                className={cn(
                  "rounded border px-2 py-0.5 text-xs",
                  durationMin === m
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-border hover:bg-accent",
                )}
              >
                {m / 60}h
              </button>
            ))}
          </div>

          {/* Location */}
          <div className="space-y-1.5">
            <Label htmlFor="ev-loc">Location</Label>
            <Input
              id="ev-loc"
              value={locationText}
              onChange={(e) => setLocationText(e.target.value)}
              placeholder="1234 Maple Lane, Falls Church, VA"
            />
            {selectedOrder?.defaultLocation && locationText !== selectedOrder.defaultLocation ? (
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                onClick={() =>
                  selectedOrder.defaultLocation &&
                  setLocationText(selectedOrder.defaultLocation)
                }
              >
                Use customer address: {selectedOrder.defaultLocation}
              </button>
            ) : null}
          </div>

          {/* Crew */}
          <div className="space-y-1.5">
            <Label>Crew</Label>
            <Popover open={crewOpen} onOpenChange={setCrewOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  type="button"
                  className="w-full justify-between font-normal"
                >
                  Add crew member…
                  <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                <Command>
                  <CommandInput placeholder="Search crew…" />
                  <CommandList>
                    <CommandEmpty>No crew match.</CommandEmpty>
                    <CommandGroup>
                      {crew
                        .filter((c) => !assignments.some((a) => a.crewMemberId === c.id))
                        .map((c) => (
                          <CommandItem
                            key={c.id}
                            value={`${c.name} ${c.role ?? ""}`}
                            onSelect={() => {
                              addCrew(c.id);
                              setCrewOpen(false);
                            }}
                          >
                            <span className="flex flex-1 flex-col">
                              <span className="text-sm">{c.name}</span>
                              {c.role ? (
                                <span className="text-[10px] text-muted-foreground">{c.role}</span>
                              ) : null}
                            </span>
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {assignments.length > 0 ? (
              <ul className="space-y-1.5">
                {assignments.map((a) => {
                  const member = crew.find((c) => c.id === a.crewMemberId);
                  const crewConflicts = conflictsByCrew.get(a.crewMemberId) ?? [];
                  return (
                    <li key={a.crewMemberId} className="rounded-md border bg-card px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {member?.name ?? "Unknown"}
                        </span>
                        <Input
                          value={a.role}
                          onChange={(e) =>
                            setAssignmentRole(a.crewMemberId, e.target.value)
                          }
                          placeholder="role on this event"
                          className="h-7 flex-1 text-xs"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeCrew(a.crewMemberId)}
                          className="h-7 px-2"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {crewConflicts.length > 0 ? (
                        <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>
                            Already on {crewConflicts[0]?.orderNumber} — {crewConflicts[0]?.projectName ?? "Untitled"}{" "}
                            {format(parseISO(crewConflicts[0]?.startsAt ?? ""), "h:mm a")}-
                            {format(parseISO(crewConflicts[0]?.endsAt ?? ""), "h:mm a")}
                            {crewConflicts.length > 1 ? ` (+${crewConflicts.length - 1} more)` : ""}
                          </span>
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                No crew assigned yet. Optional — you can schedule first and assign later.
              </p>
            )}
            {conflictBusy ? (
              <p className="text-[10px] text-muted-foreground">Checking conflicts…</p>
            ) : null}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="ev-notes">Notes</Label>
            <Textarea
              id="ev-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Side gate code 4823, customer wants seam on the right…"
            />
          </div>

          {mode === "edit" && initial ? (
            <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
              <span>
                Status: <Badge variant="secondary">{initial.status}</Badge>
              </span>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={deleting}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    Delete event
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete event?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently removes the event and all its crew
                      assignments. The order itself is not affected.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={destroy}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending} className="gap-1">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "edit" ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

