"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatInTimeZone } from "@/lib/tz";
import type { CalendarEvent } from "@/lib/queries/events";

const PAGE_SIZE = 50;

const KIND_DOT: Record<string, string> = {
  measurement: "bg-purple-500",
  install: "bg-emerald-500",
  delivery: "bg-blue-500",
  pickup: "bg-sky-500",
  other: "bg-zinc-500",
};

const STATUS_TONE: Record<string, string> = {
  scheduled: "text-foreground",
  en_route: "text-amber-600 dark:text-amber-400",
  in_progress: "text-blue-600 dark:text-blue-400",
  complete: "text-emerald-600 dark:text-emerald-400",
  cancelled: "text-muted-foreground line-through",
  no_show: "text-destructive line-through",
};

type SortKey = "starts_at" | "kind" | "order_number" | "status";

type Props = {
  events: CalendarEvent[];
  timeZone: string;
};

export function CalendarList({ events, timeZone }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sort = (searchParams.get("sort") ?? "starts_at") as SortKey;
  const dir = searchParams.get("dir") === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const sorted = useMemo(() => {
    const copy = [...events];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sort) {
        case "starts_at":
          cmp = a.startsAt.localeCompare(b.startsAt);
          break;
        case "kind":
          cmp = a.kind.localeCompare(b.kind);
          break;
        case "order_number":
          cmp = a.orderNumber.localeCompare(b.orderNumber);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
      }
      return dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [events, sort, dir]);

  const total = sorted.length;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const slice = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function updateParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    router.push(`/schedule?${params.toString()}`);
  }

  function toggleSort(key: SortKey) {
    if (sort === key) {
      updateParams({ sort: key, dir: dir === "asc" ? "desc" : "asc", page: "1" });
    } else {
      updateParams({ sort: key, dir: "asc", page: "1" });
    }
  }

  function openEvent(eventId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("event", eventId);
    router.push(`/schedule?${params.toString()}`);
  }

  if (total === 0) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center">
        <p className="text-sm font-medium">No events match.</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          Adjust the filters above, or use <strong>+ New event</strong> to add one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Date / time" active={sort === "starts_at"} dir={dir} onClick={() => toggleSort("starts_at")} />
              <SortableHead label="Kind" active={sort === "kind"} dir={dir} onClick={() => toggleSort("kind")} />
              <SortableHead label="Order #" active={sort === "order_number"} dir={dir} onClick={() => toggleSort("order_number")} />
              <TableHead>Project</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Crew</TableHead>
              <TableHead>Location</TableHead>
              <SortableHead label="Status" active={sort === "status"} dir={dir} onClick={() => toggleSort("status")} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {slice.map((ev) => (
              <TableRow
                key={ev.id}
                className="cursor-pointer"
                onClick={() => openEvent(ev.id)}
              >
                <TableCell className="whitespace-nowrap">
                  <p className="text-sm font-medium">
                    {formatInTimeZone(ev.startsAt, timeZone, "EEE, MMM d")}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatInTimeZone(ev.startsAt, timeZone, "h:mm a")} ·{" "}
                    {ev.durationMin}m
                  </p>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span
                      className={cn("h-2 w-2 rounded-full", KIND_DOT[ev.kind] ?? KIND_DOT.other)}
                    />
                    {ev.kind}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs">{ev.orderNumber}</TableCell>
                <TableCell className="max-w-[200px] truncate text-sm">
                  {ev.projectName ?? "Untitled"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {ev.customerName ?? "—"}
                </TableCell>
                <TableCell className="text-xs">
                  {ev.crew.length === 0 ? (
                    <span className="text-muted-foreground">Unassigned</span>
                  ) : (
                    ev.crew.map((c) => c.name).join(", ")
                  )}
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                  {ev.locationText ?? "—"}
                </TableCell>
                <TableCell className={cn("text-xs capitalize", STATUS_TONE[ev.status] ?? "")}>
                  {ev.status.replace(/_/g, " ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {lastPage > 1 ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => updateParams({ page: String(page - 1) })}
              className="rounded border px-2 py-0.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Prev
            </button>
            <span className="tabular-nums">
              page {page} / {lastPage}
            </span>
            <button
              type="button"
              disabled={page >= lastPage}
              onClick={() => updateParams({ page: String(page + 1) })}
              className="rounded border px-2 py-0.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SortableHead({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <TableHead>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {active ? (
          <span aria-hidden className="text-[10px]">
            {dir === "asc" ? "▲" : "▼"}
          </span>
        ) : null}
      </button>
    </TableHead>
  );
}
