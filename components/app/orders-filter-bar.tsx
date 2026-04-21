"use client";

import { useEffect, useState } from "react";
import {
  parseAsArrayOf,
  parseAsString,
  parseAsStringEnum,
  useQueryStates,
} from "nuqs";
import type { OrderStage } from "@prisma/client";
import { Check, ChevronDown, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { STAGE_LABELS } from "./pipeline-strip";
import { ORDER_STAGES } from "@/lib/validators/orders";

export const ordersFilterSchema = {
  stage: parseAsArrayOf(parseAsStringEnum<OrderStage>([...ORDER_STAGES])).withDefault([]),
  q: parseAsString.withDefault(""),
  view: parseAsStringEnum(["table", "board"] as const).withDefault("table"),
  sort: parseAsString.withDefault("updated"),
  dir: parseAsStringEnum(["asc", "desc"] as const).withDefault("desc"),
  page: parseAsString.withDefault("1"),
};

export function OrdersFilterBar() {
  const [state, setState] = useQueryStates(ordersFilterSchema, { shallow: false });
  const [localSearch, setLocalSearch] = useState(state.q);

  // Debounce search input into URL state
  useEffect(() => {
    if (localSearch === state.q) return;
    const handle = window.setTimeout(() => {
      setState({ q: localSearch, page: "1" });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [localSearch, state.q, setState]);

  function toggleStage(stage: OrderStage) {
    const next = state.stage.includes(stage)
      ? state.stage.filter((s) => s !== stage)
      : [...state.stage, stage];
    setState({ stage: next, page: "1" });
  }

  function clearAll() {
    setState({ stage: [], q: "", page: "1" });
    setLocalSearch("");
  }

  const anyActive = state.stage.length > 0 || state.q.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={localSearch}
          onChange={(event) => setLocalSearch(event.target.value)}
          placeholder="Search orders…"
          className="h-9 w-64 pl-8"
        />
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            Stage
            {state.stage.length > 0 ? (
              <span className="rounded bg-muted px-1.5 text-xs tabular-nums">
                {state.stage.length}
              </span>
            ) : null}
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-48 p-1">
          {ORDER_STAGES.filter((s) => s !== "cancelled").map((stage) => {
            const checked = state.stage.includes(stage);
            return (
              <button
                key={stage}
                type="button"
                onClick={() => toggleStage(stage)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                  checked && "font-medium",
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded border",
                    checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30",
                  )}
                >
                  {checked ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="flex-1 text-left">{STAGE_LABELS[stage]}</span>
              </button>
            );
          })}
        </PopoverContent>
      </Popover>
      {anyActive ? (
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={clearAll}>
          <X className="h-3.5 w-3.5" /> Clear
        </Button>
      ) : null}
    </div>
  );
}
