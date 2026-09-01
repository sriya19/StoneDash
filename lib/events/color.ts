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
//   stripe  — full-strength solid, for the left edge of an event block
//             or all-day pill (Task 8 Fix 2)
//   pillBg  — the all-day pill's ~30% wash, heavier than `bg` because a
//             one-line pill has less area to carry the color
type ColorVariants = {
  bg: string;
  chip: string;
  dot: string;
  ring: string;
  stripe: string;
  pillBg: string;
  // Raw hex for the picker's swatch circles. MUST equal the literal
  // color of `stripe` — the circle you click is the color you get.
  //
  // NOTE for anyone tempted to consolidate: `blue.hex` (#3B82F6) is one
  // ramp step from the design system's --info-600 (#2563EB) and they are
  // deliberately NOT the same value. --info-600 is the system's
  // informational accent (nav, links, focus) and is theme-aware; this is
  // per-event decoration the user picks, pinned to a DB CHECK constraint.
  // Merging them would let a nav-color tweak repaint every event a shop
  // has hand-colored. See DEVLOG "Task 8 sub-step 9".
  // It did not until Task 8 sub-step 9: 9 of 10 swatches painted the
  // Task-4-era brand hex (blue #2563EB) while the calendar rendered the
  // -500 ramp (#3B82F6), so the picker had been quietly lying. Pinned by
  // check 7 in `pnpm smoke:events`.
  hex: string;
};

export const EVENT_COLOR_CLASSES: Record<EventColorKey, ColorVariants> = {
  terracotta: {
    bg: "bg-orange-500/15 border-orange-500/40 text-orange-950 dark:bg-orange-500/25 dark:border-orange-500/50 dark:text-orange-50",
    stripe: "bg-orange-500",
    pillBg: "bg-orange-500/30 border-orange-500/50 text-orange-950 dark:bg-orange-500/30 dark:border-orange-500/60 dark:text-orange-50",
    chip: "bg-orange-100 text-orange-900 border-orange-300 dark:bg-orange-900/50 dark:text-orange-100 dark:border-orange-700",
    dot: "bg-orange-500",
    ring: "ring-orange-500",
    hex: "#F97316",
  },
  green: {
    bg: "bg-emerald-500/15 border-emerald-500/40 text-emerald-950 dark:bg-emerald-500/25 dark:border-emerald-500/50 dark:text-emerald-50",
    stripe: "bg-emerald-500",
    pillBg: "bg-emerald-500/30 border-emerald-500/50 text-emerald-950 dark:bg-emerald-500/30 dark:border-emerald-500/60 dark:text-emerald-50",
    chip: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/50 dark:text-emerald-100 dark:border-emerald-700",
    dot: "bg-emerald-500",
    ring: "ring-emerald-500",
    hex: "#10B981",
  },
  blue: {
    bg: "bg-blue-500/15 border-blue-500/40 text-blue-950 dark:bg-blue-500/25 dark:border-blue-500/50 dark:text-blue-50",
    stripe: "bg-blue-500",
    pillBg: "bg-blue-500/30 border-blue-500/50 text-blue-950 dark:bg-blue-500/30 dark:border-blue-500/60 dark:text-blue-50",
    chip: "bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-900/50 dark:text-blue-100 dark:border-blue-700",
    dot: "bg-blue-500",
    ring: "ring-blue-500",
    hex: "#3B82F6",
  },
  purple: {
    bg: "bg-purple-500/15 border-purple-500/40 text-purple-950 dark:bg-purple-500/25 dark:border-purple-500/50 dark:text-purple-50",
    stripe: "bg-purple-500",
    pillBg: "bg-purple-500/30 border-purple-500/50 text-purple-950 dark:bg-purple-500/30 dark:border-purple-500/60 dark:text-purple-50",
    chip: "bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-900/50 dark:text-purple-100 dark:border-purple-700",
    dot: "bg-purple-500",
    ring: "ring-purple-500",
    hex: "#A855F7",
  },
  amber: {
    bg: "bg-amber-500/15 border-amber-500/40 text-amber-950 dark:bg-amber-500/25 dark:border-amber-500/50 dark:text-amber-50",
    stripe: "bg-amber-500",
    pillBg: "bg-amber-500/30 border-amber-500/50 text-amber-950 dark:bg-amber-500/30 dark:border-amber-500/60 dark:text-amber-50",
    chip: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/50 dark:text-amber-100 dark:border-amber-700",
    dot: "bg-amber-500",
    ring: "ring-amber-500",
    hex: "#F59E0B",
  },
  rose: {
    bg: "bg-rose-500/15 border-rose-500/40 text-rose-950 dark:bg-rose-500/25 dark:border-rose-500/50 dark:text-rose-50",
    stripe: "bg-rose-500",
    pillBg: "bg-rose-500/30 border-rose-500/50 text-rose-950 dark:bg-rose-500/30 dark:border-rose-500/60 dark:text-rose-50",
    chip: "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-900/50 dark:text-rose-100 dark:border-rose-700",
    dot: "bg-rose-500",
    ring: "ring-rose-500",
    hex: "#F43F5E",
  },
  teal: {
    bg: "bg-teal-500/15 border-teal-500/40 text-teal-950 dark:bg-teal-500/25 dark:border-teal-500/50 dark:text-teal-50",
    stripe: "bg-teal-500",
    pillBg: "bg-teal-500/30 border-teal-500/50 text-teal-950 dark:bg-teal-500/30 dark:border-teal-500/60 dark:text-teal-50",
    chip: "bg-teal-100 text-teal-900 border-teal-300 dark:bg-teal-900/50 dark:text-teal-100 dark:border-teal-700",
    dot: "bg-teal-500",
    ring: "ring-teal-500",
    hex: "#14B8A6",
  },
  indigo: {
    bg: "bg-indigo-500/15 border-indigo-500/40 text-indigo-950 dark:bg-indigo-500/25 dark:border-indigo-500/50 dark:text-indigo-50",
    stripe: "bg-indigo-500",
    pillBg: "bg-indigo-500/30 border-indigo-500/50 text-indigo-950 dark:bg-indigo-500/30 dark:border-indigo-500/60 dark:text-indigo-50",
    chip: "bg-indigo-100 text-indigo-900 border-indigo-300 dark:bg-indigo-900/50 dark:text-indigo-100 dark:border-indigo-700",
    dot: "bg-indigo-500",
    ring: "ring-indigo-500",
    hex: "#6366F1",
  },
  slate: {
    bg: "bg-slate-500/15 border-slate-500/40 text-slate-950 dark:bg-slate-500/25 dark:border-slate-500/50 dark:text-slate-50",
    stripe: "bg-slate-500",
    pillBg: "bg-slate-500/30 border-slate-500/50 text-slate-950 dark:bg-slate-500/30 dark:border-slate-500/60 dark:text-slate-50",
    chip: "bg-slate-100 text-slate-900 border-slate-300 dark:bg-slate-900/50 dark:text-slate-100 dark:border-slate-700",
    dot: "bg-slate-500",
    ring: "ring-slate-500",
    hex: "#64748B",
  },
  brown: {
    // Tailwind doesn't have a "brown" palette; the amber-700/800 end is
    // the right family. Distinct enough from `amber` (which uses 500) to
    // read as separate side-by-side.
    bg: "bg-amber-700/15 border-amber-700/40 text-amber-950 dark:bg-amber-700/25 dark:border-amber-700/50 dark:text-amber-50",
    stripe: "bg-amber-800",
    pillBg: "bg-amber-700/30 border-amber-700/50 text-amber-950 dark:bg-amber-700/30 dark:border-amber-700/60 dark:text-amber-50",
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
