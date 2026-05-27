"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

const VIEWS = [
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
  { id: "list", label: "List" },
] as const;

export type ScheduleView = (typeof VIEWS)[number]["id"];

type Props = {
  current: ScheduleView;
};

export function ScheduleViewTabs({ current }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function pick(view: ScheduleView) {
    if (view === current) return;
    const params = new URLSearchParams(searchParams.toString());
    if (view === "week") params.delete("view");
    else params.set("view", view);
    // Drop list-only params when switching away from list, since week/day
    // anchor on a single date rather than a range.
    if (view !== "list") {
      params.delete("from");
      params.delete("to");
    }
    const next = params.toString();
    router.push(`/schedule${next ? `?${next}` : ""}`);
  }

  return (
    <div className="inline-flex items-center rounded-md border bg-card p-0.5 text-xs">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => pick(v.id)}
          className={cn(
            "rounded px-3 py-1 transition-colors",
            current === v.id
              ? "bg-accent font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={current === v.id}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
