import { z } from "zod";

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
