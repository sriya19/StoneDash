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
