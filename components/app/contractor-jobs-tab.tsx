"use client";

import Link from "next/link";
import { useState } from "react";
import { format, parseISO } from "date-fns";
import type { OrderStage } from "@prisma/client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { OrderStageBadge } from "@/components/app/order-stage-badge";
import { balanceClass } from "@/components/app/contractors-table";
import type { ContractorJob } from "@/lib/queries/contractors";

type Props = {
  jobs: ContractorJob[];
  currency: string;
};

function moneyFmt(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
}

export function ContractorJobsTab({ jobs, currency }: Props) {
  const [showCancelled, setShowCancelled] = useState(false);

  const active = jobs.filter((j) => j.stage !== "cancelled");
  const cancelled = jobs.filter((j) => j.stage === "cancelled");

  if (active.length === 0 && cancelled.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center">
        <p className="text-sm font-medium">No jobs yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Tag a new or existing order with this contractor to see it here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order #</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Homeowner</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Quoted</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Install</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {active.map((job) => (
              <JobRow key={job.id} job={job} currency={currency} />
            ))}
            {showCancelled
              ? cancelled.map((job) => (
                  <JobRow key={job.id} job={job} currency={currency} muted />
                ))
              : null}
          </TableBody>
        </Table>
      </div>

      {cancelled.length > 0 ? (
        <Label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={showCancelled}
            onCheckedChange={(v) => setShowCancelled(v === true)}
          />
          Show {cancelled.length} cancelled{" "}
          {cancelled.length === 1 ? "job" : "jobs"}
        </Label>
      ) : null}
    </div>
  );
}

function JobRow({
  job,
  currency,
  muted,
}: {
  job: ContractorJob;
  currency: string;
  muted?: boolean;
}) {
  return (
    <TableRow className={cn(muted && "opacity-60")}>
      <TableCell className="font-mono text-xs">
        <Link
          href={`/orders?order=${job.id}`}
          className="hover:underline"
        >
          {job.orderNumber}
        </Link>
      </TableCell>
      <TableCell className="max-w-[220px] truncate">
        {job.projectName ?? "—"}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {job.customerName ?? "—"}
      </TableCell>
      <TableCell>
        <OrderStageBadge stage={job.stage as OrderStage} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {moneyFmt(job.quoteAmount, currency)}
      </TableCell>
      <TableCell className="text-right text-muted-foreground tabular-nums">
        {job.paidByContractor > 0 ? moneyFmt(job.paidByContractor, currency) : "—"}
      </TableCell>
      <TableCell
        className={cn(
          "text-right tabular-nums",
          balanceClass(job.contractorBalance),
        )}
      >
        {job.contractorBalance === 0
          ? "Paid"
          : job.contractorBalance < 0
            ? `Credit ${moneyFmt(job.contractorBalance, currency)}`
            : moneyFmt(job.contractorBalance, currency)}
      </TableCell>
      <TableCell className="text-right text-xs text-muted-foreground">
        {job.scheduledInstallDate
          ? format(parseISO(job.scheduledInstallDate), "MMM d, yyyy")
          : "—"}
      </TableCell>
    </TableRow>
  );
}
