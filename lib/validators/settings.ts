import { z } from "zod";

function optionalString<T extends z.ZodTypeAny>(schema: T) {
  return z
    .union([schema, z.literal(""), z.null(), z.undefined()])
    .transform((value) =>
      value === "" || value === null || value === undefined ? undefined : value,
    );
}

export const UpdateProfileInput = z.object({
  fullName: z.string().trim().min(1).max(200),
  phone: optionalString(z.string().trim().max(40)),
  theme: z.enum(["light", "dark", "system"]),
});

export type UpdateProfileInputT = z.input<typeof UpdateProfileInput>;

export const UpdateOrganizationInput = z.object({
  name: z.string().trim().min(1).max(200),
  timezone: z.string().trim().min(1).max(100),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code"),
  orderPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,6}$/, "1–6 uppercase letters or digits"),
  orderSeqStart: z.number().int().min(1).max(1_000_000),
});

export type UpdateOrganizationInputT = z.input<typeof UpdateOrganizationInput>;

export const InviteMemberInput = z.object({
  email: z.string().trim().email().toLowerCase().max(200),
  role: z.enum(["admin", "manager", "field"]),
});

export type InviteMemberInputT = z.input<typeof InviteMemberInput>;

export const UpdateMemberRoleInput = z.object({
  memberId: z.string().uuid(),
  role: z.enum(["admin", "manager", "field"]),
});

export const RemoveMemberInput = z.object({
  memberId: z.string().uuid(),
});

export const AcceptInviteInput = z.object({
  token: z.string().min(10),
});
