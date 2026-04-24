import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getCurrentUserAndOrg } from "@/lib/auth";
import {
  getContractorDetail,
  listContractorJobs,
} from "@/lib/queries/contractors";
import {
  canManageContractors,
  canRecordContractorPayments,
} from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContractorHeader } from "@/components/app/contractor-header";
import { ContractorJobsTab } from "@/components/app/contractor-jobs-tab";
import { ContractorDetailsTab } from "@/components/app/contractor-details-tab";

type Params = { id: string };
type SearchParams = { tab?: string; payment?: string };

export const metadata = { title: "Contractor · Stone & Design Board" };

export default async function ContractorDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { org, role } = await getCurrentUserAndOrg();
  const canEdit = canManageContractors(role);
  const canPay = canRecordContractorPayments(role);

  const contractor = await getContractorDetail(params.id);
  if (!contractor) notFound();

  const jobs = await listContractorJobs(params.id);

  const tab = searchParams.tab === "payments" || searchParams.tab === "details"
    ? searchParams.tab
    : "jobs";

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="gap-1 text-muted-foreground">
          <Link href="/contractors">
            <ArrowLeft className="h-4 w-4" /> All contractors
          </Link>
        </Button>
      </div>

      <ContractorHeader
        contractor={contractor}
        currency={org.currency}
        canRecordPayment={canPay}
      />

      <Tabs value={tab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="jobs" asChild>
            <Link href={`/contractors/${params.id}?tab=jobs`}>
              Jobs ({contractor.balance.jobCount})
            </Link>
          </TabsTrigger>
          <TabsTrigger value="payments" asChild>
            <Link href={`/contractors/${params.id}?tab=payments`}>
              Payments ({contractor.paymentCount})
            </Link>
          </TabsTrigger>
          <TabsTrigger value="details" asChild>
            <Link href={`/contractors/${params.id}?tab=details`}>Details</Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="jobs">
          <ContractorJobsTab jobs={jobs} currency={org.currency} />
        </TabsContent>

        <TabsContent value="payments">
          <div className="rounded-xl border bg-card p-12 text-center text-sm text-muted-foreground">
            Payments tab — coming in the next commit.
          </div>
        </TabsContent>

        <TabsContent value="details">
          <ContractorDetailsTab contractor={contractor} canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
