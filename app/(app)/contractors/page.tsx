import Link from "next/link";
import { Plus } from "lucide-react";

import { getCurrentUserAndOrg } from "@/lib/auth";
import {
  listContractorsLite,
  listContractorsWithBalance,
} from "@/lib/queries/contractors";
import { canManageContractors } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { ContractorsTable } from "@/components/app/contractors-table";
import { NewContractorDialog } from "@/components/app/new-contractor-dialog";

type SearchParams = {
  q?: string;
  active?: string;
  sort?: string;
  dir?: string;
  new?: string;
};

export const metadata = { title: "Contractors · Stone & Design Board" };

export default async function ContractorsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { org, role } = await getCurrentUserAndOrg();
  const canCreate = canManageContractors(role);

  const activeOnly = searchParams.active !== "0";
  const search = searchParams.q ?? "";

  const [rows, lite] = await Promise.all([
    listContractorsWithBalance({ activeOnly, search }),
    listContractorsLite(false),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contractors</h1>
          <p className="text-sm text-muted-foreground">
            General contractors, K&amp;B dealers, and builders who bring in jobs.
          </p>
        </div>
        {canCreate ? (
          <Button asChild size="sm" className="gap-1">
            <Link href="/contractors?new=1">
              <Plus className="h-4 w-4" /> New contractor
            </Link>
          </Button>
        ) : null}
      </header>

      <ContractorsTable
        rows={rows}
        currency={org.currency}
        totalInOrg={lite.length}
      />

      {searchParams.new === "1" ? <NewContractorDialog /> : null}
    </div>
  );
}
