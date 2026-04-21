import { z } from "zod";

// Org slug rules: lowercase letters, digits, and dashes only, 2-60 chars,
// must start with a letter and not end with a dash.
const slugRegex = /^[a-z][a-z0-9-]{0,58}[a-z0-9]$/;

// Order prefix: up to 6 characters, letters/digits (uppercase enforced).
const prefixRegex = /^[A-Z0-9]{1,6}$/;

export const OnboardingInput = z.object({
  fullName: z.string().trim().min(1, "Your name is required").max(200),
  shopName: z.string().trim().min(1, "Shop name is required").max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(slugRegex, "Use lowercase letters, numbers, and dashes"),
  timezone: z.string().trim().min(1).max(100),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code (e.g. USD)"),
  orderPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(prefixRegex, "1–6 uppercase letters or digits")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  orderSeqStart: z
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .optional(),
});

export type OnboardingInputT = z.input<typeof OnboardingInput>;
export type OnboardingOutputT = z.output<typeof OnboardingInput>;
