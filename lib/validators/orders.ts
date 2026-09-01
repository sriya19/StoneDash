import { z } from "zod";
// Type-only, so it is erased at compile time and adds no runtime dependency
// to a module that client components import. Same OrderStage the rest of the
// app uses (order-stage-badge, lib/supabase/types) rather than a second
// string union that happens to match.
import type { OrderStage } from "@prisma/client";

export const ORDER_STAGES = [
  "quote",
  "measurement",
  "fabrication",
  "ready_for_install",
  "installation",
  "invoiced",
  "paid",
  "cancelled",
] as const;

export const ORDER_PRIORITIES = ["low", "normal", "high", "rush"] as const;

export const OrderStageZ = z.enum(ORDER_STAGES);
export const OrderPriorityZ = z.enum(ORDER_PRIORITIES);

// Accepts "", null, undefined → undefined. Lets UI code pass empty strings
// without clobbering existing database values.
function optionalString<T extends z.ZodTypeAny>(schema: T) {
  return z
    .union([schema, z.literal(""), z.null(), z.undefined()])
    .transform((value) =>
      value === "" || value === null || value === undefined ? undefined : value,
    );
}

const moneyNumber = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === "" || value === null || value === undefined) return undefined;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : undefined;
  })
  .refine((n) => n === undefined || n >= 0, {
    message: "Enter a non-negative number",
  });

const dateString = optionalString(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"));

// Inline customer creation inside the New Order dialog.
const InlineCustomer = z.object({
  name: z.string().trim().min(1, "Customer name is required").max(200),
  company: optionalString(z.string().trim().max(200)),
  email: optionalString(z.string().trim().email("Invalid email").max(200)),
  phone: z.string().trim().min(4, "Phone is required").max(40),
  city: optionalString(z.string().trim().max(100)),
  state: optionalString(z.string().trim().max(100)),
});

const CustomerRef = z
  .object({
    existingCustomerId: z.string().uuid().optional(),
    newCustomer: InlineCustomer.optional(),
  })
  .refine((v) => Boolean(v.existingCustomerId) || Boolean(v.newCustomer), {
    message: "Pick an existing customer or add a new one",
    path: ["existingCustomerId"],
  });

export const CreateOrderInput = z.object({
  customer: CustomerRef,
  contractorId: optionalString(z.string().uuid()).optional(),
  projectName: z.string().trim().min(1, "Project name is required").max(200),
  stoneType: optionalString(z.string().trim().max(200)),
  edgeProfile: optionalString(z.string().trim().max(200)),
  sinkCutouts: z.number().int().min(0).max(50).default(0),
  cooktopCutouts: z.number().int().min(0).max(50).default(0),
  estimatedSqft: moneyNumber.optional(),
  quoteAmount: moneyNumber.optional(),
  depositReceived: moneyNumber.optional(),
  measuredAt: dateString.optional(),
  fabricationStartDate: dateString.optional(),
  scheduledInstallDate: dateString.optional(),
  priority: OrderPriorityZ.default("normal"),
  assignedTo: optionalString(z.string().uuid()),
  notes: optionalString(z.string().max(4000)),
});

export type CreateOrderInputT = z.input<typeof CreateOrderInput>;
export type CreateOrderOutputT = z.output<typeof CreateOrderInput>;

// Every patch field is optional. At least one must be provided (the refine).
export const UpdateOrderInput = z.object({
  id: z.string().uuid(),
  patch: z
    .object({
      projectName: optionalString(z.string().trim().max(200)).optional(),
      customerId: optionalString(z.string().uuid()).optional(),
      // contractorId can be a uuid (set/change), an empty string (clear),
      // or absent (don't touch).
      contractorId: z.union([z.string().uuid(), z.literal("")]).optional(),
      // Stage is intentionally NOT editable via updateOrder — all stage
      // changes must go through changeStage (with a required reason) so
      // order_stage_history is never written without a note.
      priority: OrderPriorityZ.optional(),
      stoneType: optionalString(z.string().trim().max(200)).optional(),
      edgeProfile: optionalString(z.string().trim().max(200)).optional(),
      sinkCutouts: z.number().int().min(0).max(50).optional(),
      cooktopCutouts: z.number().int().min(0).max(50).optional(),
      estimatedSqft: moneyNumber.optional(),
      quoteAmount: moneyNumber.optional(),
      depositReceived: moneyNumber.optional(),
      measuredAt: dateString.optional(),
      fabricationStartDate: dateString.optional(),
      scheduledInstallDate: dateString.optional(),
      installedAt: dateString.optional(),
      assignedTo: optionalString(z.string().uuid()).optional(),
      notes: optionalString(z.string().max(4000)).optional(),
    })
    .refine((p) => Object.values(p).some((v) => v !== undefined), {
      message: "No changes to save",
    }),
});

export type UpdateOrderPatchT = z.input<typeof UpdateOrderInput>["patch"];
export type UpdateOrderInputT = z.input<typeof UpdateOrderInput>;

export const ChangeStageInput = z.object({
  id: z.string().uuid(),
  toStage: OrderStageZ,
  // Required. The reason is written into order_stage_history.note and
  // activity_log.metadata.note via a session GUC the trigger reads.
  note: z
    .string()
    .trim()
    .min(3, "Reason must be at least 3 characters")
    .max(500, "Reason is too long (max 500)"),
});

export type ChangeStageInputT = z.input<typeof ChangeStageInput>;

export const BulkChangeStageInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  toStage: OrderStageZ,
});

export const DeleteOrderInput = z.object({
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Task 9 Feature A — the canonical stage-transition -> template map.
//
// This lives here, beside ORDER_STAGES, rather than in the database, because
// stage_notification_prefs stores OVERRIDES ONLY (migration 0026, PLAN Q5):
// an absent row means the transition prompts. Keeping the list in one place
// means a new org needs no seeding and cannot drift from the code.
//
// get_stage_notification_prompt takes the resolved default slug as a
// parameter for the same reason — the RPC owns pref precedence and template
// lookup, this owns which transition means what.
//
// `paid` and `cancelled` are absent deliberately: they are terminal, the
// brief specifies no prompt, and migration 0026 has a CHECK making a pref
// row for them impossible.
// ---------------------------------------------------------------------------

export type StageNotificationTransition = {
  /** null = "from any stage". No entry uses it yet; the schema allows it. */
  from: OrderStage | null;
  to: OrderStage;
  /** Slug in message_templates. Pinned by smoke:messaging check 14. */
  templateSlug: string;
};

export const STAGE_NOTIFICATION_TRANSITIONS: StageNotificationTransition[] = [
  { from: "quote", to: "measurement", templateSlug: "measurement_scheduled" },
  { from: "measurement", to: "fabrication", templateSlug: "in_fabrication" },
  { from: "fabrication", to: "ready_for_install", templateSlug: "ready_for_install" },
  { from: "ready_for_install", to: "installation", templateSlug: "install_eta" },
  { from: "installation", to: "invoiced", templateSlug: "invoice_sent" },
];

/**
 * The transition entry for a stage move, or undefined when the move is not
 * one we notify about (a backwards move, a skip, or a terminal stage).
 *
 * Prefers an exact from->to match, then a "from any stage" entry for the
 * same target — the same precedence get_stage_notification_prompt applies
 * to pref rows, kept deliberately identical so the two cannot disagree.
 */
export function stageNotificationTransition(
  from: OrderStage | null,
  to: OrderStage,
): StageNotificationTransition | undefined {
  return (
    STAGE_NOTIFICATION_TRANSITIONS.find((t) => t.to === to && t.from === from) ??
    STAGE_NOTIFICATION_TRANSITIONS.find((t) => t.to === to && t.from === null)
  );
}
