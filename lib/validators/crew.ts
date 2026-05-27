import { z } from "zod";

function optionalString<T extends z.ZodTypeAny>(schema: T) {
  return z
    .union([schema, z.literal(""), z.null(), z.undefined()])
    .transform((value) =>
      value === "" || value === null || value === undefined ? undefined : value,
    );
}

export const CrewMemberFields = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  role: optionalString(z.string().trim().max(100)),
  phone: optionalString(z.string().trim().max(40)),
  email: optionalString(z.string().trim().email("Invalid email").max(200)),
  notes: optionalString(z.string().max(4000)),
  isActive: z.boolean().default(true),
});

export type CrewMemberFieldsT = z.input<typeof CrewMemberFields>;

export const CreateCrewMemberInput = CrewMemberFields;

export const UpdateCrewMemberInput = z.object({
  id: z.string().uuid(),
  patch: CrewMemberFields.partial().refine(
    (p) => Object.values(p).some((v) => v !== undefined),
    { message: "No changes to save" },
  ),
});

export type UpdateCrewMemberInputT = z.input<typeof UpdateCrewMemberInput>;

export const DeleteCrewMemberInput = z.object({
  id: z.string().uuid(),
});

// Free text — these are the suggestions for the role datalist.
export const CREW_ROLE_SUGGESTIONS = [
  "Lead Installer",
  "Helper",
  "Fabricator",
  "Measurement Tech",
  "Driver",
] as const;
