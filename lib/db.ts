// Prisma client singleton.
//
// Intended ONLY for the seed script and any future service-role jobs (cron,
// webhooks). App-path reads and writes must go through @supabase/ssr so that
// RLS policies enforce tenancy; importing this module from a server action
// would bypass RLS.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
