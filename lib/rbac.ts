import type { MemberRole } from "@prisma/client";

// Role hierarchy: owner > admin > manager > field.
// Each role inherits everything a lower-numbered role can do.
const LEVEL: Record<MemberRole, number> = {
  owner: 4,
  admin: 3,
  manager: 2,
  field: 1,
};

export function hasAtLeast(actual: MemberRole, minimum: MemberRole): boolean {
  return LEVEL[actual] >= LEVEL[minimum];
}

export function canManageMembers(role: MemberRole): boolean {
  return role === "owner" || role === "admin";
}

export function canEditOrganization(role: MemberRole): boolean {
  return role === "owner" || role === "admin";
}

export function canDeleteOrganization(role: MemberRole): boolean {
  return role === "owner";
}

export function canManageCustomers(role: MemberRole): boolean {
  return hasAtLeast(role, "manager");
}

export function canCreateOrder(role: MemberRole): boolean {
  return hasAtLeast(role, "manager");
}

export function canDeleteOrder(role: MemberRole): boolean {
  return hasAtLeast(role, "manager");
}

// Field users can advance stage and edit notes, nothing else.
export function canEditOrderFully(role: MemberRole): boolean {
  return hasAtLeast(role, "manager");
}
