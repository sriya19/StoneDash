import { Plus } from "lucide-react";
import Link from "next/link";

import { getCurrentUserAndOrg } from "@/lib/auth";
import {
  getCustomerDetail,
  listCustomersWithOrderCount,
} from "@/lib/queries/customers-full";
import { canManageCustomers } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { CustomersTable } from "@/components/app/customers-table";
import { CustomerDetailSheet } from "@/components/app/customer-detail-sheet";
import { NewCustomerDialog } from "@/components/app/new-customer-dialog";

type SearchParams = {
  id?: string;
  new?: string;
};

export const metadata = { title: "Customers · Stone & Design Board" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { org, role } = await getCurrentUserAndOrg();
  const canCreate = canManageCustomers(role);

  const rows = await listCustomersWithOrderCount();

  const detailId = searchParams.id ?? null;
  const showNew = searchParams.new === "1";

  const detail = detailId ? await getCustomerDetail(detailId, org.timezone) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">
            Every contact and the orders they&apos;re attached to.
          </p>
        </div>
        {canCreate ? (
          <Button asChild size="sm" className="gap-1">
            <Link href="/customers?new=1">
              <Plus className="h-4 w-4" /> New customer
            </Link>
          </Button>
        ) : null}
      </header>

      <CustomersTable rows={rows} />

      {showNew ? <NewCustomerDialog /> : null}
      {detailId ? (
        <CustomerDetailSheet
          customer={detail?.detail ?? null}
          orders={detail?.orders ?? []}
          role={role}
          currency={org.currency}
        />
      ) : null}
    </div>
  );
}
