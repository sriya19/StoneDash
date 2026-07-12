import { z } from "zod";

function optionalString<T extends z.ZodTypeAny>(schema: T) {
  return z
    .union([schema, z.literal(""), z.null(), z.undefined()])
    .transform((value) =>
      value === "" || value === null || value === undefined ? undefined : value,
    );
}

export const EVENT_KINDS = [
  "measurement",
  "install",
  "delivery",
  "pickup",
  "other",
  "task",
  "repair",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

// Task 6B palette keys — mirrors the CHECK constraint on
// order_events.color (see 0020_event_color_and_pg_trgm.sql). NULL
// stored means "use the kind default" — the client resolves via
// getEventColor(event) in lib/events/color.ts (sub-step 3).
export const EVENT_COLOR_KEYS = [
  "terracotta",
  "green",
  "blue",
  "purple",
  "amber",
  "rose",
  "teal",
  "indigo",
  "slate",
  "brown",
] as const;
export type EventColorKey = (typeof EVENT_COLOR_KEYS)[number];

export const EVENT_STATUSES = [
  "scheduled",
  "en_route",
  "in_progress",
  "complete",
  "cancelled",
  "no_show",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

// Default durations per kind (minutes). Matches the seed defaults and the
// quick-pick buttons in the dialog.
export const DEFAULT_DURATION_MIN: Record<EventKind, number> = {
  measurement: 60,
  install: 180,
  delivery: 60,
  pickup: 30,
  other: 60,
  task: 60,
  repair: 60,
};

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  measurement: "Measurement",
  install: "Install",
  delivery: "Delivery",
  pickup: "Pickup",
  other: "Other",
  task: "Task",
  repair: "Repair",
};

const Assignment = z.object({
  crewMemberId: z.string().uuid(),
  role: optionalString(z.string().trim().max(80)),
});

// Date in YYYY-MM-DD; time in HH:mm (24h). Parsed against the org tz on
// the server side via lib/tz.ts to produce the UTC timestamptz for storage.
const eventDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const eventTime = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:mm");

// Either orderId or title must be set. All-day events ignore startTime
// (server normalizes to 00:00 org-local) and durationMin (server forces
// 1440).
const EventBase = z
  .object({
    orderId: optionalString(z.string().uuid()),
    title: optionalString(z.string().trim().max(200)),
    isAllDay: z.boolean().default(false),
    kind: z.enum(EVENT_KINDS),
    date: eventDate,
    startTime: eventTime,
    durationMin: z
      .union([z.string(), z.number()])
      .transform((v) => (typeof v === "number" ? v : Number(v)))
      .refine((n) => Number.isFinite(n) && n > 0 && n <= 24 * 60, {
        message: "Duration must be between 1 and 1440 minutes",
      }),
    locationText: optionalString(z.string().trim().max(500)),
    notes: optionalString(z.string().max(4000)),
    assignments: z.array(Assignment).default([]),
    // Task 6B: user-picked color override. NULL means "use the kind
    // default"; validated on both sides — the enum here + the CHECK
    // constraint on the column + the RPC's whitelist.
    color: z
      .union([z.enum(EVENT_COLOR_KEYS), z.null(), z.undefined()])
      .transform((v) => (v === undefined || v === null ? null : v))
      .optional(),
  })
  .refine((v) => v.orderId !== undefined || (v.title && v.title.length > 0), {
    message: "Standalone events require a title",
    path: ["title"],
  });

export const CreateEventInput = EventBase;
export type CreateEventInputT = z.input<typeof CreateEventInput>;

export const UpdateEventInput = EventBase.and(
  z.object({ eventId: z.string().uuid() }),
);
export type UpdateEventInputT = z.input<typeof UpdateEventInput>;

export const DeleteEventInput = z.object({
  eventId: z.string().uuid(),
});

export const RescheduleEventInput = z.object({
  eventId: z.string().uuid(),
  date: eventDate,
  startTime: eventTime,
  durationMin: z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "number" ? v : Number(v)))
    .refine((n) => Number.isFinite(n) && n > 0 && n <= 24 * 60, {
      message: "Duration must be between 1 and 1440 minutes",
    }),
});

export const UpdateEventStatusInput = z.object({
  eventId: z.string().uuid(),
  status: z.enum(EVENT_STATUSES),
});
