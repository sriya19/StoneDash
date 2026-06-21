"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ArrowDown, ArrowUp, HardHat, Plus, StickyNote, Wrench } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import type { OrderListRow } from "@/lib/queries/orders";
import { OrderStageBadge } from "./order-stage-badge";
import { NotesPopover } from "./notes-popover";
import { InstallDate } from "./install-date";
import { TablePagination } from "./table-pagination";
import { EmptyState } from "./empty-state";

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
        className={cn(
          // -ml-3 negates the TableHead's px-3 so the button label aligns
          // with the cell's natural left edge. text-[11px] uppercase
          // tracking-wider matches the static TableHead style; active
          // sort flips the color to brand so the column is glanceable.
          "-ml-3 h-7 gap-1 px-3 text-[11px] font-medium uppercase tracking-wider",
          active ? "text-brand hover:text-brand" : "text-muted-foreground",
        )}
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

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title="No orders match."
        description="Try clearing filters or create a new order."
      />
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
              <TableHead className="w-[36px]" aria-label="Notes" />
              <TableHead className="w-[140px]">{sortHeader("stage")}</TableHead>
              <TableHead className="w-[140px]">Contractor</TableHead>
              <TableHead className="w-[120px]">Stone</TableHead>
              <TableHead className="w-[160px]">{sortHeader("install")}</TableHead>
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
                <TableCell
                  className="w-[36px] p-0"
                  onClick={(event) => event.stopPropagation()}
                >
                  <NotesCell orderId={row.id} notes={row.notes} />
                </TableCell>
                <TableCell>
                  <OrderStageBadge stage={row.stage} />
                </TableCell>
                <TableCell className="truncate text-xs">
                  {row.contractors ? (
                    <Link
                      href={`/contractors/${row.contractors.id}`}
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <HardHat className="h-3 w-3" />
                      {row.contractors.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </TableCell>
                <TableCell className="truncate text-xs text-muted-foreground">
                  {row.stone_type ?? "—"}
                </TableCell>
                <TableCell>
                  <InstallDate
                    value={row.scheduled_install_date}
                    stage={row.stage}
                    size="sm"
                  />
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
      <TablePagination
        total={total}
        page={page}
        pageSize={pageSize}
        hrefForPage={(p) => withParams({ page: String(p) })}
        unit={{ singular: "order", plural: "orders" }}
      />
    </div>
  );
}

function NotesCell({
  orderId,
  notes,
}: {
  orderId: string;
  notes: string | null;
}) {
  const hasNotes = typeof notes === "string" && notes.trim().length > 0;
  if (!hasNotes) {
    return (
      <NotesPopover
        orderId={orderId}
        value=""
        trigger={
          <button
            type="button"
            aria-label="Add note"
            className="flex h-8 w-full items-center justify-center text-muted-foreground/40 hover:text-muted-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        }
      />
    );
  }

  const preview = notes.trim().slice(0, 400);
  const truncated = notes.trim().length > 400;

  return (
    <HoverCard openDelay={120}>
      <HoverCardTrigger asChild>
        <div>
          <NotesPopover
            orderId={orderId}
            value={notes}
            trigger={
              <button
                type="button"
                aria-label="Edit note"
                className="flex h-8 w-full items-center justify-center text-brand hover:text-brand/80"
              >
                <StickyNote className="h-3.5 w-3.5" />
              </button>
            }
          />
        </div>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        className="max-w-[360px] whitespace-pre-wrap text-xs leading-relaxed"
      >
        {preview}
        {truncated ? "…" : null}
      </HoverCardContent>
    </HoverCard>
  );
}
