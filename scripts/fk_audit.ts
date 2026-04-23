import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  const rows = await prisma.$queryRawUnsafe<
    { table: string; constraint_name: string; definition: string }[]
  >(`
    SELECT
      conrelid::regclass::text AS "table",
      conname AS "constraint_name",
      pg_get_constraintdef(oid) AS "definition"
    FROM pg_constraint
    WHERE contype = 'f'
      AND connamespace = 'public'::regnamespace
    ORDER BY conrelid::regclass::text, conname;
  `);
  for (const row of rows) {
    process.stdout.write(row.table + "." + row.constraint_name + "\n");
    process.stdout.write("  " + row.definition + "\n");
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
