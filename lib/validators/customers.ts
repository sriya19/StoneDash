import { z } from "zod";

function optionalString<T extends z.ZodTypeAny>(schema: T) {
  return z
    .union([schema, z.literal(""), z.null(), z.undefined()])
    .transform((value) =>
      value === "" || value === null || value === undefined ? undefined : value,
    );
}

export const CustomerFields = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  company: optionalString(z.string().trim().max(200)),
  email: optionalString(z.string().trim().email("Invalid email").max(200)),
  phone: optionalString(z.string().trim().max(40)),
  addressLine1: optionalString(z.string().trim().max(200)),
  addressLine2: optionalString(z.string().trim().max(200)),
  city: optionalString(z.string().trim().max(100)),
  state: optionalString(z.string().trim().max(100)),
  postalCode: optionalString(z.string().trim().max(20)),
  notes: optionalString(z.string().max(4000)),
});

export type CustomerFieldsT = z.input<typeof CustomerFields>;

export const CreateCustomerInput = CustomerFields;

export const UpdateCustomerInput = z.object({
  id: z.string().uuid(),
  patch: CustomerFields.partial().refine(
    (p) => Object.values(p).some((v) => v !== undefined),
    { message: "No changes to save" },
  ),
});

export const DeleteCustomerInput = z.object({
  id: z.string().uuid(),
});
