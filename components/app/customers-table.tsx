"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { format, parseISO } from "date-fns";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CustomerWithOrders } from "@/lib/queries/customers-full";

type Props = {
  rows: CustomerWithOrders[];
};

function lastOrderDate(rows: CustomerWithOrders["orders"]): string | null {
  if (rows.length === 0) return null;
  let max = rows[0]?.created_at ?? null;
  for (const r of rows) {
    if (r.created_at > (max ?? "")) max = r.created_at;
  }
  return max;
}

export function CustomersTable({ rows }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function openDetail(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("id", id);
    router.push(`/customers?${params.toString()}`);
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center">
        <p className="text-sm font-medium">No customers yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add your first customer to start logging orders.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="text-right">Orders</TableHead>
            <TableHead className="text-right">Last order</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const last = lastOrderDate(row.orders);
            return (
              <TableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => openDetail(row.id)}
              >
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {row.company ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.phone ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.email ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.orders.length}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {last ? format(parseISO(last), "MMM d, yyyy") : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
