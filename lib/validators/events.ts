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
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

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
};

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  measurement: "Measurement",
  install: "Install",
  delivery: "Delivery",
  pickup: "Pickup",
  other: "Other",
};

const Assignment = z.object({
  crewMemberId: z.string().uuid(),
  role: optionalString(z.string().trim().max(80)),
});

// Date in YYYY-MM-DD; time in HH:mm (24h). Parsed against the org tz on
// the server side via lib/tz.ts to produce the UTC timestamptz for storage.
const eventDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const eventTime = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:mm");

const EventBase = z.object({
  orderId: z.string().uuid(),
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
});

export const CreateEventInput = EventBase;
export type CreateEventInputT = z.input<typeof CreateEventInput>;

export const UpdateEventInput = EventBase.extend({
  eventId: z.string().uuid(),
});
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
