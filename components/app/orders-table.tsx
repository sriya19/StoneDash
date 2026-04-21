"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ArrowDown, ArrowUp } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OrderListRow } from "@/lib/queries/orders";
import { OrderStageBadge } from "./order-stage-badge";

type Props = {
  rows: OrderListRow[];
  total: number;
  page: number;
  pageSize: number;
  currency: string;
  currentSort: string;
  currentDir: "asc" | "desc";
};

function formatMoney(value: string | null, currency: string): string {
  const n = value ? Number(value) : 0;
  if (!Number.isFinite(n) || n === 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "MMM d");
  } catch {
    return value;
  }
}

function formatRelative(value: string): string {
  try {
    return format(parseISO(value), "MMM d, HH:mm");
  } catch {
    return value;
  }
}

const SORTABLE: Record<string, string> = {
  orderNumber: "Order #",
  customer: "Customer",
  project: "Project",
  stage: "Stage",
  install: "Install",
  balance: "Balance",
  updated: "Updated",
};

export function OrdersTable({
  rows,
  total,
  page,
  pageSize,
  currency,
  currentSort,
  currentDir,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function withParams(changes: Record<string, string | null>): string {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    return `/orders?${params.toString()}`;
  }

  function sortHeader(key: keyof typeof SORTABLE) {
    const active = currentSort === key;
    const nextDir = active && currentDir === "desc" ? "asc" : "desc";
    return (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 h-7 gap-1 px-2 text-xs font-medium text-muted-foreground"
        onClick={() => router.push(withParams({ sort: key, dir: nextDir, page: "1" }))}
      >
        {SORTABLE[key]}
        {active ? (
          currentDir === "desc" ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUp className="h-3 w-3" />
          )
        ) : null}
      </Button>
    );
  }

  function openDetail(id: string) {
    router.push(withParams({ order: id }));
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center">
        <p className="text-sm font-medium">No orders match.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Try clearing filters or create a new order.
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
              <TableHead className="w-[110px]">{sortHeader("orderNumber")}</TableHead>
              <TableHead>{sortHeader("customer")}</TableHead>
              <TableHead>{sortHeader("project")}</TableHead>
              <TableHead className="w-[140px]">{sortHeader("stage")}</TableHead>
              <TableHead className="w-[120px]">Stone</TableHead>
              <TableHead className="w-[90px]">{sortHeader("install")}</TableHead>
              <TableHead className="w-[110px] text-right">{sortHeader("balance")}</TableHead>
              <TableHead className="w-[120px] text-right">{sortHeader("updated")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => openDetail(row.id)}
              >
                <TableCell className="font-mono text-xs">{row.order_number}</TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{row.customers?.name ?? "—"}</span>
                    {row.customers?.company ? (
                      <span className="text-xs text-muted-foreground">
                        {row.customers.company}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="max-w-[280px] truncate">
                  {row.project_name ?? "—"}
                </TableCell>
                <TableCell>
                  <OrderStageBadge stage={row.stage} />
                </TableCell>
                <TableCell className="truncate text-xs text-muted-foreground">
                  {row.stone_type ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDate(row.scheduled_install_date)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-xs tabular-nums",
                    Number(row.balance_due) > 0 ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {formatMoney(row.balance_due, currency)}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {formatRelative(row.updated_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total.toLocaleString()} order{total === 1 ? "" : "s"} · page {page} of {totalPages}
        </span>
        <div className="flex gap-1">
          <Button
            asChild
            variant="outline"
            size="sm"
            disabled={page <= 1}
            className={cn(page <= 1 && "pointer-events-none opacity-50")}
          >
            <Link href={withParams({ page: String(page - 1) })}>Prev</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            className={cn(page >= totalPages && "pointer-events-none opacity-50")}
          >
            <Link href={withParams({ page: String(page + 1) })}>Next</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
