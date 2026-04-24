import { z } from "zod";

function optionalString<T extends z.ZodTypeAny>(schema: T) {
  return z
    .union([schema, z.literal(""), z.null(), z.undefined()])
    .transform((value) =>
      value === "" || value === null || value === undefined ? undefined : value,
    );
}

export const ContractorFields = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  primaryContact: optionalString(z.string().trim().max(200)),
  phone: optionalString(z.string().trim().max(40)),
  email: optionalString(z.string().trim().email("Invalid email").max(200)),
  addressLine1: optionalString(z.string().trim().max(200)),
  addressLine2: optionalString(z.string().trim().max(200)),
  city: optionalString(z.string().trim().max(100)),
  state: optionalString(z.string().trim().max(100)),
  postalCode: optionalString(z.string().trim().max(20)),
  paymentTerms: optionalString(z.string().trim().max(100)),
  notes: optionalString(z.string().max(4000)),
  isActive: z.boolean().default(true),
});

export type ContractorFieldsT = z.input<typeof ContractorFields>;

export const CreateContractorInput = ContractorFields;

export const UpdateContractorInput = z.object({
  id: z.string().uuid(),
  patch: ContractorFields.partial().refine(
    (p) => Object.values(p).some((v) => v !== undefined),
    { message: "No changes to save" },
  ),
});

export type UpdateContractorInputT = z.input<typeof UpdateContractorInput>;

export const DeleteContractorInput = z.object({
  id: z.string().uuid(),
});

// Suggestions for the payment-terms datalist; free-form input still wins.
export const PAYMENT_TERMS_SUGGESTIONS = [
  "Net 30",
  "Net 60",
  "Running tab",
  "COD",
] as const;

export const PAYMENT_METHODS = [
  "check",
  "ach",
  "cash",
  "card",
  "other",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  check: "Check",
  ach: "ACH / wire",
  cash: "Cash",
  card: "Card",
  other: "Other",
};

const moneyPositive = z
  .union([z.string(), z.number()])
  .transform((value) => {
    if (value === "" || value === null || value === undefined) return NaN;
    return typeof value === "number" ? value : Number(value);
  })
  .refine((n) => Number.isFinite(n) && n > 0, {
    message: "Must be greater than 0",
  });

const PaymentAllocation = z.object({
  orderId: z.string().uuid(),
  amount: moneyPositive,
});

const PaymentBase = z.object({
  contractorId: z.string().uuid(),
  amount: moneyPositive,
  receivedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  method: z.enum(PAYMENT_METHODS).optional(),
  reference: optionalString(z.string().trim().max(120)),
  notes: optionalString(z.string().max(4000)),
  allocations: z.array(PaymentAllocation).min(1, "Add at least one allocation"),
});

// Refines the sum-of-allocations = amount invariant client-side. The RPC
// enforces it again server-side — this is just the first gate.
const allocationSumMatches = (v: {
  amount: number;
  allocations: { amount: number }[];
}) => {
  const sum = v.allocations.reduce((acc, a) => acc + a.amount, 0);
  return Math.abs(sum - v.amount) < 0.005;
};

const SUM_MESSAGE = {
  message: "Allocation total must equal payment amount",
  path: ["allocations"] as string[],
};

export const RecordPaymentInput = PaymentBase.refine(
  allocationSumMatches,
  SUM_MESSAGE,
);
export type RecordPaymentInputT = z.input<typeof RecordPaymentInput>;

export const UpdatePaymentInput = PaymentBase.extend({
  paymentId: z.string().uuid(),
}).refine(allocationSumMatches, SUM_MESSAGE);
export type UpdatePaymentInputT = z.input<typeof UpdatePaymentInput>;

export const DeletePaymentInput = z.object({
  paymentId: z.string().uuid(),
});
