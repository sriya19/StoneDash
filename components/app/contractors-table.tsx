"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { Search } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  balanceClass,
  formatBalance,
} from "@/lib/contractors/balance-display";
import type { ContractorListRow } from "@/lib/queries/contractors";

type Props = {
  rows: ContractorListRow[];
  currency: string;
  totalInOrg: number;
};

type SortKey = "name" | "balance" | "activeJobs" | "lastPayment";

export function ContractorsTable({ rows, currency, totalInOrg }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeOnly = searchParams.get("active") !== "0";
  const search = searchParams.get("q") ?? "";
  const sort = (searchParams.get("sort") ?? "balance") as SortKey;
  const dir = searchParams.get("dir") === "asc" ? "asc" : "desc";

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sort) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "balance":
          cmp = a.balanceOwed - b.balanceOwed;
          break;
        case "activeJobs":
          cmp = a.activeJobCount - b.activeJobCount;
          break;
        case "lastPayment":
          cmp =
            (a.lastPaymentOn ?? "").localeCompare(b.lastPaymentOn ?? "");
          break;
      }
      return dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort, dir]);

  function updateParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    router.replace(`/contractors?${params.toString()}`);
  }

  function toggleSort(key: SortKey) {
    if (sort === key) {
      updateParams({ sort: key, dir: dir === "asc" ? "desc" : "asc" });
    } else {
      updateParams({
        sort: key,
        // Name starts ascending; money/jobs/date columns start descending.
        dir: key === "name" ? "asc" : "desc",
      });
    }
  }

  const emptyShown = sorted.length === 0;
  const emptyState = totalInOrg === 0 ? "org" : "filtered";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or contact…"
            defaultValue={search}
            onChange={(e) => {
              const value = e.target.value;
              updateParams({ q: value.length >= 2 ? value : null });
            }}
            className="pl-8"
          />
        </div>
        <Label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={activeOnly}
            onCheckedChange={(v) =>
              updateParams({ active: v === true ? null : "0" })
            }
          />
          Active only
        </Label>
      </div>

      {emptyShown ? (
        emptyState === "org" ? (
          <div className="rounded-xl border bg-card p-12 text-center">
            <p className="text-sm font-medium">No contractors yet.</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Add one when a job comes in through a general contractor, dealer,
              or builder.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
            No contractors match the current filter.
          </div>
        )
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead
                  label="Name"
                  active={sort === "name"}
                  dir={dir}
                  onClick={() => toggleSort("name")}
                />
                <TableHead>Primary contact</TableHead>
                <TableHead>Phone</TableHead>
                <SortableHead
                  className="text-right"
                  label="Active jobs"
                  active={sort === "activeJobs"}
                  dir={dir}
                  onClick={() => toggleSort("activeJobs")}
                />
                <SortableHead
                  className="text-right"
                  label="Balance owed"
                  active={sort === "balance"}
                  dir={dir}
                  onClick={() => toggleSort("balance")}
                />
                <SortableHead
                  className="text-right"
                  label="Last payment"
                  active={sort === "lastPayment"}
                  dir={dir}
                  onClick={() => toggleSort("lastPayment")}
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/contractors/${row.id}`)}
                >
                  <TableCell>
                    <Link
                      href={`/contractors/${row.id}`}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.name}
                    </Link>
                    {!row.isActive ? (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        Inactive
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.primaryContact ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.phone ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.activeJobCount}
                  </TableCell>
                  <TableCell className={cn("text-right", balanceClass(row.balanceOwed))}>
                    {row.balanceOwed === 0
                      ? "All settled"
                      : formatBalance(row.balanceOwed, currency)}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {row.lastPaymentOn
                      ? format(parseISO(row.lastPaymentOn), "MMM d, yyyy")
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function SortableHead({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {active ? (
          <span aria-hidden className="text-[10px]">
            {dir === "asc" ? "▲" : "▼"}
          </span>
        ) : null}
      </button>
    </TableHead>
  );
}
