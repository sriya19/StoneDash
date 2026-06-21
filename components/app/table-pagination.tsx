"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  total: number;
  page: number;
  pageSize: number;
  // Caller controls the href shape so this component can sit on any
  // route. Pages are 1-indexed; the function should return a path
  // that preserves the rest of the current URL state (filters, sort,
  // etc.) — typical callers wrap a `withParams` helper.
  hrefForPage: (page: number) => string;
  // Custom unit label so the same component reads naturally on /orders
  // ("3 orders") and /customers ("3 customers") without each table
  // re-implementing pagination chrome.
  unit?: { singular: string; plural: string };
  className?: string;
};

// Minimal Prev / Next + page indicator. Replaces per-table pagination
// implementations so every list surface gets the same chrome — and so
// CSV-import preview tables (sub-steps 9-12) can drop the same component
// without re-inventing the wheel.
export function TablePagination({
  total,
  page,
  pageSize,
  hrefForPage,
  unit = { singular: "item", plural: "items" },
  className,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const label = total === 1 ? unit.singular : unit.plural;
  const atStart = page <= 1;
  const atEnd = page >= totalPages;

  return (
    <div
      className={cn(
        "flex items-center justify-between text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="tabular-nums">
        {total.toLocaleString()} {label} · page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-1">
        <Button
          asChild={!atStart}
          variant="outline"
          size="sm"
          disabled={atStart}
          className={cn("h-8 gap-1 px-2.5", atStart && "pointer-events-none opacity-50")}
        >
          {atStart ? (
            <span>
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </span>
          ) : (
            <Link href={hrefForPage(page - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </Link>
          )}
        </Button>
        <Button
          asChild={!atEnd}
          variant="outline"
          size="sm"
          disabled={atEnd}
          className={cn("h-8 gap-1 px-2.5", atEnd && "pointer-events-none opacity-50")}
        >
          {atEnd ? (
            <span>
              Next <ChevronRight className="h-3.5 w-3.5" />
            </span>
          ) : (
            <Link href={hrefForPage(page + 1)}>
              Next <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </Button>
      </div>
    </div>
  );
}
