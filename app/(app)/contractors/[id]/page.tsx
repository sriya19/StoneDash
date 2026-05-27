import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getCurrentUserAndOrg } from "@/lib/auth";
import {
  getContractorDetail,
  getContractorPayment,
  listContractorJobs,
  listContractorPayments,
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
import { ContractorPaymentsTab } from "@/components/app/contractor-payments-tab";
import { RecordPaymentSheet } from "@/components/app/record-payment-sheet";

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

  const [jobs, payments] = await Promise.all([
    listContractorJobs(params.id, org.timezone),
    listContractorPayments(params.id),
  ]);

  const paymentParam = searchParams.payment ?? null;
  const editingPayment =
    paymentParam && paymentParam !== "new"
      ? await getContractorPayment(paymentParam)
      : null;
  const showPaymentSheet =
    canPay && (paymentParam === "new" || editingPayment !== null);

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
          <ContractorPaymentsTab
            contractorId={contractor.id}
            payments={payments}
            currency={org.currency}
            canEdit={canPay}
          />
        </TabsContent>

        <TabsContent value="details">
          <ContractorDetailsTab contractor={contractor} canEdit={canEdit} />
        </TabsContent>
      </Tabs>

      {showPaymentSheet ? (
        <RecordPaymentSheet
          contractorId={contractor.id}
          contractorName={contractor.name}
          currency={org.currency}
          jobs={jobs}
          editPayment={editingPayment}
        />
      ) : null}
    </div>
  );
}
