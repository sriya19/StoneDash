// Task 6B — single source of truth for event colors.
//
// Every calendar surface reads through `getEventColor(event)` +
// looks up `EVENT_COLOR_CLASSES[key][variant]`. Before this, four
// files had their own hardcoded kind→color maps (event-block,
// order-events-tab, crew-detail-sheet, /j/[slug]) which drifted
// over time (e.g. install was emerald in event-block but green
// in crew-detail-sheet).
//
// The palette keys are the same 10 curated values that the DB
// CHECK constraint on `order_events.color` accepts. NULL on the
// row means "use the kind default" — reproduced here in
// `KIND_DEFAULT_COLOR`.
//
// Per PLAN Q5: this module is client-safe (no server-only imports)
// so both the calendar rendering AND the color picker inside the
// event dialog consume it.

import type { EventColorKey } from "@/lib/validators/events";

// Palette key → per-variant Tailwind classes. Each variant is one
// visual context; each caller reaches for whichever it needs.
//
//   bg      — full colored background + border + text (event blocks)
//   chip    — small colored badge (order-events-tab chip, /j/[slug])
//   dot     — a solid-color marker (crew-detail-sheet history dots,
//             pipeline-strip stage dots by extension pattern)
//   ring    — an outline ring used by the picker to mark the active
//             selection

type ColorVariants = {
  bg: string;
  chip: string;
  dot: string;
  ring: string;
  // Raw hex — used by the picker's swatch circles so the color the
  // user sees IS the color that stores.
  hex: string;
};

export const EVENT_COLOR_CLASSES: Record<EventColorKey, ColorVariants> = {
  terracotta: {
    bg: "bg-orange-100/80 border-orange-400/60 text-orange-950 dark:bg-orange-900/40 dark:border-orange-500/60 dark:text-orange-50",
    chip: "bg-orange-100 text-orange-900 border-orange-300 dark:bg-orange-900/50 dark:text-orange-100 dark:border-orange-700",
    dot: "bg-orange-500",
    ring: "ring-orange-500",
    hex: "#C2410C",
  },
  green: {
    bg: "bg-emerald-100/80 border-emerald-400/60 text-emerald-950 dark:bg-emerald-900/40 dark:border-emerald-500/60 dark:text-emerald-50",
    chip: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/50 dark:text-emerald-100 dark:border-emerald-700",
    dot: "bg-emerald-500",
    ring: "ring-emerald-500",
    hex: "#16A34A",
  },
  blue: {
    bg: "bg-blue-100/80 border-blue-400/60 text-blue-950 dark:bg-blue-900/40 dark:border-blue-500/60 dark:text-blue-50",
    chip: "bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-900/50 dark:text-blue-100 dark:border-blue-700",
    dot: "bg-blue-500",
    ring: "ring-blue-500",
    hex: "#2563EB",
  },
  purple: {
    bg: "bg-purple-100/80 border-purple-400/60 text-purple-950 dark:bg-purple-900/40 dark:border-purple-500/60 dark:text-purple-50",
    chip: "bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-900/50 dark:text-purple-100 dark:border-purple-700",
    dot: "bg-purple-500",
    ring: "ring-purple-500",
    hex: "#9333EA",
  },
  amber: {
    bg: "bg-amber-100/80 border-amber-400/60 text-amber-950 dark:bg-amber-900/40 dark:border-amber-500/60 dark:text-amber-50",
    chip: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/50 dark:text-amber-100 dark:border-amber-700",
    dot: "bg-amber-500",
    ring: "ring-amber-500",
    hex: "#D97706",
  },
  rose: {
    bg: "bg-rose-100/80 border-rose-400/60 text-rose-950 dark:bg-rose-900/40 dark:border-rose-500/60 dark:text-rose-50",
    chip: "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-900/50 dark:text-rose-100 dark:border-rose-700",
    dot: "bg-rose-500",
    ring: "ring-rose-500",
    hex: "#E11D48",
  },
  teal: {
    bg: "bg-teal-100/80 border-teal-400/60 text-teal-950 dark:bg-teal-900/40 dark:border-teal-500/60 dark:text-teal-50",
    chip: "bg-teal-100 text-teal-900 border-teal-300 dark:bg-teal-900/50 dark:text-teal-100 dark:border-teal-700",
    dot: "bg-teal-500",
    ring: "ring-teal-500",
    hex: "#0D9488",
  },
  indigo: {
    bg: "bg-indigo-100/80 border-indigo-400/60 text-indigo-950 dark:bg-indigo-900/40 dark:border-indigo-500/60 dark:text-indigo-50",
    chip: "bg-indigo-100 text-indigo-900 border-indigo-300 dark:bg-indigo-900/50 dark:text-indigo-100 dark:border-indigo-700",
    dot: "bg-indigo-500",
    ring: "ring-indigo-500",
    hex: "#4F46E5",
  },
  slate: {
    bg: "bg-slate-100/80 border-slate-400/60 text-slate-950 dark:bg-slate-900/40 dark:border-slate-500/60 dark:text-slate-50",
    chip: "bg-slate-100 text-slate-900 border-slate-300 dark:bg-slate-900/50 dark:text-slate-100 dark:border-slate-700",
    dot: "bg-slate-500",
    ring: "ring-slate-500",
    hex: "#475569",
  },
  brown: {
    // Tailwind doesn't have a "brown" palette; amber-800/900 is the
    // right family. Distinct enough from `amber` (which uses 100/500)
    // to read as separate side-by-side.
    bg: "bg-amber-200/70 border-amber-700/60 text-amber-950 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-50",
    chip: "bg-amber-200 text-amber-950 border-amber-800/40 dark:bg-amber-950/60 dark:text-amber-100 dark:border-amber-800",
    dot: "bg-amber-800",
    ring: "ring-amber-800",
    hex: "#92400E",
  },
};

// Per-kind defaults. Applied when `event.color IS NULL` (which is
// every event created before 6B landed + every user-doesn't-touch-
// the-picker case). Matches the brief's spec.
export const KIND_DEFAULT_COLOR: Record<string, EventColorKey> = {
  measurement: "purple",
  install: "green",
  delivery: "blue",
  pickup: "teal",
  task: "slate",
  other: "slate",
  // Task 6B: repair events (added to the kind CHECK in migration
  // 0020) default to amber — draws the eye without competing with
  // the terracotta brand.
  repair: "amber",
};

// The public API every consumer uses.
export function getEventColor(event: {
  kind: string;
  color: string | null;
}): EventColorKey {
  if (event.color && isValidColorKey(event.color)) {
    return event.color;
  }
  return KIND_DEFAULT_COLOR[event.kind] ?? "slate";
}

function isValidColorKey(v: string): v is EventColorKey {
  return v in EVENT_COLOR_CLASSES;
}

// Convenience for the picker.
export const ALL_COLOR_KEYS: EventColorKey[] = Object.keys(
  EVENT_COLOR_CLASSES,
) as EventColorKey[];
