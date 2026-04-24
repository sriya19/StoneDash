import Link from "next/link";
import { Mail, Phone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { balanceClass, formatBalance } from "@/components/app/contractors-table";
import type { ContractorDetail } from "@/lib/queries/contractors";

type Props = {
  contractor: ContractorDetail;
  currency: string;
  canRecordPayment: boolean;
};

function moneyFmt(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
}

export function ContractorHeader({ contractor, currency, canRecordPayment }: Props) {
  const { balance } = contractor;
  const { balanceOwed, jobCount, activeJobCount, jobsTotal } = balance;

  const helperLine =
    jobCount === 0
      ? "No jobs yet"
      : `across ${activeJobCount} active ${pl("job", activeJobCount)} · ${jobCount} total`;

  const balanceLabel =
    balanceOwed === 0
      ? "All settled"
      : balanceOwed < 0
        ? `Credit ${moneyFmt(balanceOwed, currency)}`
        : moneyFmt(balanceOwed, currency);

  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{contractor.name}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {contractor.primaryContact ? (
              <span>{contractor.primaryContact}</span>
            ) : null}
            {contractor.phone ? (
              <a
                href={`tel:${contractor.phone}`}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <Phone className="h-3.5 w-3.5" />
                {contractor.phone}
              </a>
            ) : null}
            {contractor.email ? (
              <a
                href={`mailto:${contractor.email}`}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <Mail className="h-3.5 w-3.5" />
                {contractor.email}
              </a>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {contractor.paymentTerms ? (
              <Badge variant="secondary" className="font-normal">
                {contractor.paymentTerms}
              </Badge>
            ) : null}
            {!contractor.isActive ? (
              <Badge variant="outline" className="font-normal">
                Inactive
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Balance owed
          </p>
          <p
            className={cn(
              "mt-1 font-mono font-semibold tabular-nums",
              balanceOwed === 0
                ? "text-xl text-muted-foreground"
                : "text-4xl md:text-5xl",
              balanceClass(balanceOwed),
            )}
          >
            {balanceLabel}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {helperLine}
            {jobsTotal > 0 ? (
              <>
                {" · "}
                <span>{moneyFmt(jobsTotal, currency)} invoiced</span>
              </>
            ) : null}
          </p>
          {canRecordPayment && balanceOwed > 0 ? (
            <Button asChild size="sm" className="mt-3">
              <Link href={`/contractors/${contractor.id}?payment=new`}>
                Record payment
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function pl(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}

// Kept around even when balanceClass/formatBalance are the usual import —
// if we later want the same header inside a smaller card (e.g. the orders
// detail sheet), we don't have to refactor.
export { formatBalance };
