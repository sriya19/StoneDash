"use client";

import { useEffect, useState } from "react";
import {
  parseAsArrayOf,
  parseAsString,
  parseAsStringEnum,
  useQueryStates,
} from "nuqs";
import { Check, ChevronDown, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  EVENT_KINDS,
  EVENT_KIND_LABELS,
  EVENT_STATUSES,
  type EventKind,
  type EventStatus,
} from "@/lib/validators/events";
import type { CrewLite } from "@/lib/queries/crew";

export const scheduleFilterSchema = {
  kind: parseAsArrayOf(parseAsStringEnum<EventKind>([...EVENT_KINDS])).withDefault([]),
  crew: parseAsArrayOf(parseAsString).withDefault([]),
  status: parseAsArrayOf(parseAsStringEnum<EventStatus>([...EVENT_STATUSES])).withDefault([]),
  q: parseAsString.withDefault(""),
  from: parseAsString.withDefault(""),
  to: parseAsString.withDefault(""),
};

const STATUS_LABELS: Record<EventStatus, string> = {
  scheduled: "Scheduled",
  en_route: "En route",
  in_progress: "In progress",
  complete: "Complete",
  cancelled: "Cancelled",
  no_show: "No-show",
};

type Props = {
  crewOptions: CrewLite[];
  showDateRange: boolean; // only the list view exposes from/to inputs
};

export function ScheduleFilterBar({ crewOptions, showDateRange }: Props) {
  const [state, setState] = useQueryStates(scheduleFilterSchema, { shallow: false });
  const [localSearch, setLocalSearch] = useState(state.q);

  useEffect(() => {
    if (localSearch === state.q) return;
    const handle = window.setTimeout(() => {
      setState({ q: localSearch });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [localSearch, state.q, setState]);

  function toggleKind(k: EventKind) {
    const next = state.kind.includes(k)
      ? state.kind.filter((x) => x !== k)
      : [...state.kind, k];
    setState({ kind: next });
  }

  function toggleStatus(s: EventStatus) {
    const next = state.status.includes(s)
      ? state.status.filter((x) => x !== s)
      : [...state.status, s];
    setState({ status: next });
  }

  function toggleCrew(id: string) {
    const next = state.crew.includes(id)
      ? state.crew.filter((x) => x !== id)
      : [...state.crew, id];
    setState({ crew: next });
  }

  function clearAll() {
    setState({ kind: [], crew: [], status: [], q: "", from: "", to: "" });
    setLocalSearch("");
  }

  const anyActive =
    state.kind.length > 0 ||
    state.crew.length > 0 ||
    state.status.length > 0 ||
    state.q.length > 0 ||
    state.from.length > 0 ||
    state.to.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="Search order, project, customer…"
          className="h-9 w-64 pl-8"
        />
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            Kind
            {state.kind.length > 0 ? (
              <span className="rounded bg-muted px-1.5 text-xs tabular-nums">
                {state.kind.length}
              </span>
            ) : null}
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-1">
          {EVENT_KINDS.map((k) => {
            const checked = state.kind.includes(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleKind(k)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                  checked && "font-medium",
                )}
              >
                <CheckBox checked={checked} />
                <span className="flex-1 text-left">{EVENT_KIND_LABELS[k]}</span>
              </button>
            );
          })}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            Status
            {state.status.length > 0 ? (
              <span className="rounded bg-muted px-1.5 text-xs tabular-nums">
                {state.status.length}
              </span>
            ) : null}
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-1">
          {EVENT_STATUSES.map((s) => {
            const checked = state.status.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                  checked && "font-medium",
                )}
              >
                <CheckBox checked={checked} />
                <span className="flex-1 text-left">{STATUS_LABELS[s]}</span>
              </button>
            );
          })}
        </PopoverContent>
      </Popover>

      {crewOptions.length > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1">
              Crew
              {state.crew.length > 0 ? (
                <span className="rounded bg-muted px-1.5 text-xs tabular-nums">
                  {state.crew.length}
                </span>
              ) : null}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-1">
            <div className="max-h-72 overflow-y-auto">
              {crewOptions.map((c) => {
                const checked = state.crew.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCrew(c.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                      checked && "font-medium",
                    )}
                  >
                    <CheckBox checked={checked} />
                    <span className="flex-1 truncate text-left">
                      {c.name}
                      {c.role ? (
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          {c.role}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}

      {showDateRange ? (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Input
            type="date"
            value={state.from}
            onChange={(e) => setState({ from: e.target.value })}
            className="h-9 w-[140px]"
            aria-label="From date"
          />
          <span>→</span>
          <Input
            type="date"
            value={state.to}
            onChange={(e) => setState({ to: e.target.value })}
            className="h-9 w-[140px]"
            aria-label="To date"
          />
        </div>
      ) : null}

      {anyActive ? (
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={clearAll}>
          <X className="h-3.5 w-3.5" /> Clear
        </Button>
      ) : null}
    </div>
  );
}

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "flex h-4 w-4 items-center justify-center rounded border",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/30",
      )}
    >
      {checked ? <Check className="h-3 w-3" /> : null}
    </span>
  );
}
